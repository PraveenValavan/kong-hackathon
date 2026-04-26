export default function Topbar({ title, timeFilter, onTimeFilterChange }) {
  return (
    <div className="topbar">
      <span className="page-title">{title}</span>
      <span className="breadcrumb">/ {new Date().toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}</span>
      <div className="topbar-spacer" />
      <div className="time-filter">
        {['7d', '30d', '90d', 'All'].map(f => (
          <button
            key={f}
            className={`tf-btn${timeFilter === f ? ' active' : ''}`}
            onClick={() => onTimeFilterChange(f)}
          >
            {f}
          </button>
        ))}
      </div>
      <div className="alert-pill">
        <div className="alert-dot" />
        R&amp;D over budget
      </div>
    </div>
  );
}
