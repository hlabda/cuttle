import { beforeEach, describe, it, expect, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

vi.mock('@/stores/auth', () => ({ useAuthStore: () => ({ username: 'me' }) }));
const gameHistory = vi.hoisted(() => ({ isSpectating: false, gameStates: [] }));
vi.mock('@/stores/gameHistory', () => ({ useGameHistoryStore: () => gameHistory }));
const route = vi.hoisted(() => ({ query: {} }));
vi.mock('vue-router', () => ({ useRoute: () => route }));
const socket = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), request: vi.fn() }));
vi.mock('@/plugins/sails.js', () => ({ io: { socket } }));
vi.mock('@/plugins/sockets/inGameEvents', () => ({ handleInGameEvents: vi.fn() }));
vi.mock('@/router', () => ({ default: {}, ROUTE_NAME_VS_AI: 'vsAI' }));

const { useGameStore } = await import('@/stores/game');

const hidden = () => ({ isHidden: true });
const revealed = (id, rank, suit) => ({ id, rank, suit, isRevealed: true });
const card = (id, rank, suit) => ({ id, rank, suit });
const glasses = { id: 80, rank: 8, suit: 3 };

// A non-empty deck keeps showOpponentHand false, so the hand stays masked unless I have glasses
const gameWith = (opponentHand, myFaceCards = []) => ({
  deck: [ { id: 90, rank: 2, suit: 1 }, { id: 91, rank: 4, suit: 1 } ],
  players: [
    { pNum: 0, username: 'me', hand: [], points: [], faceCards: myFaceCards },
    { pNum: 1, username: 'them', hand: opponentHand, points: [], faceCards: [] },
  ],
});

/**
 * The opponent's hand is keyed by slot rather than by card, so that a card keeps its DOM node
 * while it is in the hand: revealing it flips that node in place, and a card leaving releases
 * its own node. These assert the two halves of that, which pull in opposite directions.
 */
describe('Opponent hand slot keys', () => {
  let store;

  beforeEach(() => {
    gameHistory.isSpectating = false;
    route.query = {};
    setActivePinia(createPinia());
    store = useGameStore();
  });

  const keys = () => store.opponent.hand.map(({ handKey }) => handKey);

  it('Gives every card in a hidden hand its own key', () => {
    store.updateGame(gameWith([ hidden(), hidden(), hidden() ]));

    expect(keys()).toHaveLength(3);
    expect(new Set(keys()).size).toBe(3);
    expect(keys().every((key) => key !== undefined)).toBe(true);
  });

  it('Keeps every key when a four reveals cards, so they flip in place', () => {
    store.updateGame(gameWith([ hidden(), hidden(), hidden(), hidden(), hidden() ]));
    const before = keys();

    // The victim reveals their 1st, 3rd and 5th cards; the hand neither shrinks nor reorders
    store.updateGame(
      gameWith([ revealed(1, 1, 2), hidden(), revealed(2, 13, 3), hidden(), revealed(3, 7, 0) ]),
    );

    expect(keys()).toEqual(before);
  });

  it('Releases only the discarded cards keys, so the rest stay put', async () => {
    store.updateGame(gameWith([ hidden(), hidden(), hidden(), hidden(), hidden() ]));
    store.updateGame(
      gameWith([ revealed(1, 1, 2), hidden(), revealed(2, 13, 3), hidden(), revealed(3, 7, 0) ]),
    );
    const [ aceKey, firstHiddenKey, kingKey, secondHiddenKey, sevenKey ] = keys();

    // The caster picks the ace and the king; the seven stays revealed in the hand
    vi.useFakeTimers();
    const resolving = store.processFours(
      [ revealed(1, 1, 2), revealed(2, 13, 3) ],
      gameWith([ hidden(), hidden(), revealed(3, 7, 0) ]),
    );
    // Partway through, the discards are still in the hand holding their own keys
    expect(keys()).toEqual([ aceKey, firstHiddenKey, kingKey, secondHiddenKey, sevenKey ]);
    await vi.advanceTimersByTimeAsync(1000);
    await resolving;
    vi.useRealTimers();

    expect(keys()).toEqual([ firstHiddenKey, secondHiddenKey, sevenKey ]);
    expect(keys()).not.toContain(aceKey);
    expect(keys()).not.toContain(kingKey);
  });

  it('Keeps existing keys when the opponent draws', () => {
    store.updateGame(gameWith([ hidden(), hidden() ]));
    const before = keys();

    store.updateGame(gameWith([ hidden(), hidden(), hidden() ]));

    expect(keys().slice(0, 2)).toEqual(before);
    expect(before).not.toContain(keys()[2]);
  });

  it('Keeps a face-up card in its slot when glasses reveal the rest of the hand', () => {
    // Both players have already seen the king, so it is face up in the first slot
    store.updateGame(gameWith([ revealed(1, 13, 2), hidden(), hidden(), hidden(), hidden() ]));
    const before = keys();

    // Glasses show the whole hand, in the order the server keeps it
    store.updateGame(
      gameWith(
        [ revealed(1, 13, 2), card(2, 3, 0), card(3, 9, 1), card(4, 6, 3), card(5, 1, 2) ],
        [ glasses ],
      ),
    );

    expect(keys()).toEqual(before);
    expect(store.opponent.hand.map(({ id }) => id)).toEqual([ 1, 2, 3, 4, 5 ]);
  });

  it('Keeps a face-up hand in order when the opponent draws', () => {
    const faceUpHand = [ revealed(1, 13, 2), card(2, 3, 0), card(3, 9, 1), card(4, 6, 3), card(5, 1, 2) ];
    store.updateGame(gameWith(faceUpHand, [ glasses ]));
    const before = keys();

    // A drawn card joins the end of the hand, so it must not reorder the cards already showing
    store.updateGame(gameWith([ ...faceUpHand, card(6, 2, 0) ], [ glasses ]));

    expect(keys().slice(0, 5)).toEqual(before);
    expect(store.opponent.hand.map(({ id }) => id)).toEqual([ 1, 2, 3, 4, 5, 6 ]);
  });

  it('Still sorts my own hand by rank', () => {
    const game = gameWith([ hidden() ]);
    game.players[0].hand = [ card(7, 13, 2), card(8, 3, 0), card(9, 1, 2) ];
    store.updateGame(game);

    expect(store.player.hand.map(({ id }) => id)).toEqual([ 9, 8, 7 ]);
  });

  // A game I am only watching: both players hold a king and an ace, in the server's order
  const watchedGame = (opponentHand = [ card(1, 13, 2), card(2, 1, 2) ]) => {
    const game = gameWith(opponentHand);
    game.players[0] = { ...game.players[0], username: 'someoneElse', hand: [ card(3, 13, 0), card(4, 1, 0) ] };
    return game;
  };
  const handIds = () => store.players.map(({ hand }) => hand.map(({ id }) => id));

  it('Sorts both hands by rank for a spectator', () => {
    gameHistory.isSpectating = true;
    store.updateGame(watchedGame());

    expect(handIds()).toEqual([ [ 4, 3 ], [ 2, 1 ] ]);
  });

  it('Sorts both hands for a spectator on the first board, before the spectate url is set', async () => {
    // Entering from the spectate list: the board loads inside the route guard, so the url (and
    // with it isSpectating) still says this is not a spectator
    socket.request.mockImplementationOnce((_request, respond) =>
      respond(null, { statusCode: 200, body: { game: watchedGame() } }),
    );

    await store.requestSpectate(7, -1);

    expect(handIds()).toEqual([ [ 4, 3 ], [ 2, 1 ] ]);
  });

  it('Keeps both hands sorted when a move lands while the spectate url is still loading', async () => {
    socket.request.mockImplementationOnce((_request, respond) =>
      respond(null, { statusCode: 200, body: { game: watchedGame() } }),
    );
    await store.requestSpectate(7, -1);

    // The in-game event handler passes a draw straight to updateGame, still before the url is set
    store.updateGame(watchedGame([ card(1, 13, 2), card(2, 1, 2), card(5, 2, 0) ]));

    expect(handIds()).toEqual([ [ 4, 3 ], [ 2, 5, 1 ] ]);
  });

  it('Keeps sorting my own hand when I replay my game from the other seat', () => {
    // I played seat 0; both of us hold a king and an ace, in the server's order
    const myGame = () => {
      const game = gameWith([ card(1, 13, 2), card(2, 1, 2) ]);
      game.players[0].hand = [ card(3, 13, 0), card(4, 1, 0) ];
      return game;
    };
    route.query = { pNum: '1' };

    // The first board lands before the spectate url is set, then the same board again after it
    store.updateGame(myGame());
    const whileLoading = handIds();
    gameHistory.isSpectating = true;
    store.updateGame(myGame());

    expect(whileLoading).toEqual([ [ 4, 3 ], [ 1, 2 ] ]);
    expect(handIds()).toEqual(whileLoading);
  });

  it('Keeps a revealed cards key while the cards around it leave', () => {
    store.updateGame(gameWith([ revealed(1, 1, 2), hidden(), hidden() ]));
    const [ aceKey ] = keys();

    store.updateGame(gameWith([ revealed(1, 1, 2) ]));

    expect(keys()).toEqual([ aceKey ]);
  });
});
