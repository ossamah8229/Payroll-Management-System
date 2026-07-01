import { Link } from 'react-router-dom';

export function NotFoundPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-2 bg-bg text-center">
      <div className="text-2xl font-bold text-text">404</div>
      <p className="text-xs text-text-muted">This page doesn't exist.</p>
      <Link to="/" className="text-xs font-medium text-accent hover:text-accent-mid">
        Back to Dashboard
      </Link>
    </div>
  );
}
