import { useNavigate } from "react-router-dom";

export default function HowToPlayPage() {
  const navigate = useNavigate();

  return (
    <div className="home-page">
      <div className="home-card htp-card">
        <button className="secondary-btn profile-back-btn" onClick={() => navigate("/")}>
          ← Back
        </button>

        <div className="brand-badge">♠ ♥ ♦ ♣</div>
        <h1>How to Play Mendikot</h1>

        <section className="htp-section">
          <h2>The Basics</h2>
          <p>
            Mendikot is a trick-taking card game for 4 or 6 players, split into two
            equal teams (partners sit across from each other). Cards rank 3 (low) up
            to Ace (high) — there are no 2s in the deck. Each player gets an equal hand.
          </p>
        </section>

        <section className="htp-section">
          <h2>The Goal: Capture the Tens</h2>
          <p>
            There are four Tens in the deck — one per suit. They're the most valuable
            cards in the game. Your team's main goal each round is to win tricks that
            contain Tens.
          </p>
        </section>

        <section className="htp-section">
          <h2>Trump Suit</h2>
          <p>
            There's no trump at the start of a round. The first time any player can't
            follow the suit that was led, they may play any card — and that card's
            suit instantly becomes trump for the rest of the round. From then on,
            trump cards beat every other suit.
          </p>
        </section>

        <section className="htp-section">
          <h2>Playing a Trick</h2>
          <p>
            The player to the dealer's left leads the first trick. Everyone must
            follow the led suit if they can. The highest card of the led suit wins
            the trick — unless someone plays trump, in which case the highest trump
            wins. The trick winner leads the next trick.
          </p>
        </section>

        <section className="htp-section">
          <h2>Scoring a Round</h2>
          <ul className="htp-list">
            <li><strong>Normal win (+1 pt):</strong> Your team captures at least one Ten, or wins the most tricks if no Tens were split evenly.</li>
            <li><strong>Mendikot (+5 pts):</strong> Your team captures all four Tens in a single round.</li>
            <li><strong>Bawanya (+10 pts):</strong> Your team wins every single trick in the round — the biggest win possible.</li>
          </ul>
        </section>

        <section className="htp-section">
          <h2>Winning the Match</h2>
          <p>
            Scores carry over across rounds. The first team to reach the target score
            wins the match. Play with friends in a multiplayer room, or practice
            solo against bots of varying difficulty.
          </p>
        </section>

        <button className="primary-btn" onClick={() => navigate("/")} style={{ marginTop: 12 }}>
          Got it — let's play
        </button>
      </div>
    </div>
  );
}
