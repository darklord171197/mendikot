import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { AVATAR_OPTIONS, getAvatar, setAvatar } from "../avatars";
import { getStats, BADGES, getUnlockedBadgeIds } from "../stats";

export default function ProfilePage() {
  const navigate = useNavigate();
  const [avatar, setAvatarState] = useState(getAvatar());
  const stats = getStats();
  const unlocked = new Set(getUnlockedBadgeIds(stats));

  const pickAvatar = (emoji) => {
    setAvatar(emoji);
    setAvatarState(emoji);
  };

  return (
    <div className="home-page">
      <div className="home-card profile-card">
        <button className="secondary-btn profile-back-btn" onClick={() => navigate("/")}>
          ← Back
        </button>

        <div className="profile-avatar-display">{avatar}</div>
        <h1>Your Profile</h1>

        <div className="avatar-picker">
          {AVATAR_OPTIONS.map((emoji) => (
            <button
              key={emoji}
              type="button"
              className={"avatar-option" + (emoji === avatar ? " avatar-selected" : "")}
              onClick={() => pickAvatar(emoji)}
            >
              {emoji}
            </button>
          ))}
        </div>

        <div className="stats-grid">
          <div className="stat-box">
            <div className="stat-value">{stats.roundsPlayed}</div>
            <div className="stat-label">Rounds Played</div>
          </div>
          <div className="stat-box">
            <div className="stat-value">{stats.wins}</div>
            <div className="stat-label">Wins</div>
          </div>
          <div className="stat-box">
            <div className="stat-value">{stats.losses}</div>
            <div className="stat-label">Losses</div>
          </div>
          <div className="stat-box">
            <div className="stat-value">{stats.mendikots}</div>
            <div className="stat-label">Mendikots</div>
          </div>
          <div className="stat-box">
            <div className="stat-value">{stats.bawanyas}</div>
            <div className="stat-label">Bawanyas</div>
          </div>
        </div>

        <h2 className="badges-title">Badges</h2>
        <div className="badges-grid">
          {BADGES.map((b) => {
            const isUnlocked = unlocked.has(b.id);
            return (
              <div
                key={b.id}
                className={"badge-box" + (isUnlocked ? " badge-unlocked" : " badge-locked")}
                title={isUnlocked ? b.label : "Locked — " + b.label}
              >
                <div className="badge-icon">{isUnlocked ? b.icon : "🔒"}</div>
                <div className="badge-label">{b.label}</div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
