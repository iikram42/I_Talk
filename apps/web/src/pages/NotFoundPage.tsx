import { Link } from 'react-router';
import { PageShell } from '../components/PageShell';

export function NotFoundPage() {
  return (
    <PageShell>
      <div className="py-16 text-center">
        <h1 className="text-2xl font-semibold">Page not found</h1>
        <Link to="/" className="mt-4 inline-block text-sm font-medium text-accent hover:underline">
          Go to the home page
        </Link>
      </div>
    </PageShell>
  );
}
