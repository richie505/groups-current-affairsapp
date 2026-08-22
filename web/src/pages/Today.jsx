import { Navigate } from 'react-router-dom';
import useResource from '../hooks/useResource';
import Loading from '../components/Loading';
import ErrorState from '../components/ErrorState';
import EmptyState from '../components/EmptyState';
import { IconCalendar } from '../components/Icon';

// "Today" resolves to the most recent *published* digest, not to the actual
// calendar date.
//
// The distinction matters on any day the pipeline has not run or the admin has
// not approved: landing on a literal today with nothing on it makes a working
// app look broken, whereas the latest digest is always something to read. The
// date is visible on the page it lands on, so nothing is misrepresented.
export default function Today() {
  const { data, error, loading, reload } = useResource('/today');

  if (loading) return <Loading label="Finding the latest digest…" />;
  if (error) return <ErrorState error={error} onRetry={reload} />;

  if (!data.date) {
    return (
      <EmptyState
        icon={IconCalendar}
        text="No digests have been published yet. Once the pipeline runs and a day is approved, it will appear here."
      />
    );
  }

  return <Navigate to={`/day/${data.date}`} replace />;
}
