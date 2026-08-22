import useResource from '../hooks/useResource';
import Loading from '../components/Loading';
import ErrorState from '../components/ErrorState';
import EmptyState from '../components/EmptyState';
import ItemCard from '../components/ItemCard';
import { IconBookmark } from '../components/Icon';

// Save-for-later. Distinct from "read" (which is progress, and unlocks the
// questions) and from filing to a bank (which is a Group-I decision about
// where an argument belongs): this is just "come back to this one", for the
// item skimmed on a phone at 11pm.
export default function Bookmarks() {
  const { data, error, loading, reload } = useResource('/bookmarks');

  if (loading) return <Loading />;
  if (error) return <ErrorState error={error} onRetry={reload} />;

  return (
    <div>
      <h1 className="mb-1 text-2xl font-bold text-slate-900">Saved</h1>
      <p className="mb-5 text-sm text-slate-600">
        {data.items.length} item{data.items.length === 1 ? '' : 's'} saved to come back to.
      </p>

      {data.items.length === 0 ? (
        <EmptyState
          icon={IconBookmark}
          text="Nothing saved yet. Use Save on any item to keep it here."
        />
      ) : (
        <div className="space-y-3">
          {data.items.map((item) => (
            <ItemCard key={item.id} item={item} showDate />
          ))}
        </div>
      )}
    </div>
  );
}
