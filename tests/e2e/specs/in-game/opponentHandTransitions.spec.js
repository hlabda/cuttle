import { Card } from '../../fixtures/cards';

const cards = '[data-opponent-hand-card]';
const hiddenCards = '[data-opponent-hand-card=""]';
const fixture = {
  p0Hand: [ Card.EIGHT_OF_SPADES, Card.ACE_OF_CLUBS ],
  p0Points: [],
  p0FaceCards: [],
  p1Hand: [ Card.THREE_OF_CLUBS, Card.NINE_OF_DIAMONDS, Card.KING_OF_HEARTS ],
  p1Points: [],
  p1FaceCards: [],
};

// Fixture changes exercise both directions without changing the game's rule that
// cards already seen through glasses remain public after those glasses are scrapped.
for (const [ width, height ] of [ [ 1280, 800 ], [ 390, 844 ] ]) {
  describe(`Opponent hand transitions at ${width}px`, () => {
    beforeEach(() => {
      cy.viewport(width, height);
      cy.setupGameAsP0();
    });

    it('Flips both ways on the same upright, fixed-size card slots', () => {
      cy.loadGameFixture(0, fixture);
      cy.get(hiddenCards).should('have.length', 3);
      cy.get(`${cards} .opponent-card-back`).should('have.length', 3);
      cy.get(cards).then(($cards) => {
        const nodes = [ ...$cards ];
        const sizes = nodes.map((node) => node.getBoundingClientRect());
        const turns = [];
        cy.document().then((doc) => {
          doc.addEventListener('transitionrun', (event) => {
            if (event.target.closest('.opponent-card-surface')) {
              turns.push({ classes: event.target.className, property: event.propertyName });
            }
          });
        });
        const checkSlots = () => {
          cy.get(cards).should(($current) => {
            expect([ ...$current ]).to.deep.equal(nodes);
            [ ...$current ].forEach((node, index) => {
              const size = node.getBoundingClientRect();
              expect(size.width).to.be.closeTo(sizes[index].width, 1);
              expect(size.height).to.be.closeTo(sizes[index].height, 1);
            });
          });
        };

        cy.loadGameFixture(0, { ...fixture, p0FaceCards: [ Card.EIGHT_OF_HEARTS ] });
        cy.get(`${cards} .face-card`).should('have.length', 3);
        cy.get('.opponent-card-flip-enter-active, .opponent-card-flip-leave-active').should('not.exist');
        checkSlots();
        cy.get('.opponent-hand-wrapper').should('have.css', 'transform', 'none');

        cy.loadGameFixture(0, fixture);
        cy.get(hiddenCards).should('have.length', 3);
        cy.get(`${cards} .opponent-card-back`).should('have.length', 3);
        cy.get(`${cards} .face-card`).should('not.exist');
        cy.get('.opponent-card-flip-enter-active, .opponent-card-flip-leave-active').should('not.exist');
        checkSlots();
        cy.then(() => {
          for (const face of [ 'opponent-card-back', 'face-card' ]) {
            for (const phase of [ 'enter-active', 'leave-active' ]) {
              expect(turns.some(({ classes }) => classes.includes(face) && classes.includes(phase))).to.equal(true);
            }
          }
          expect(turns.every(({ property }) => property === 'transform')).to.equal(true);
        });
      });
    });

    it('Reveals the opponent hand in place when the deck is exhausted', () => {
      cy.loadGameFixture(0, fixture);
      cy.get(hiddenCards).should('have.length', 3);
      cy.get(cards).then(($cards) => {
        const nodes = [ ...$cards ];
        cy.loadGameFixture(0, { ...fixture, deck: [] });
        cy.get(`${cards} .face-card`).should('have.length', 3);
        cy.get(cards).should(($current) => expect([ ...$current ]).to.deep.equal(nodes));
      });
    });
  });
}
