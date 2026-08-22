import { useSearchParams } from 'react-router-dom';
import useResource from '../hooks/useResource';
import Loading from '../components/Loading';
import ErrorState from '../components/ErrorState';
import EmptyState from '../components/EmptyState';
import ItemCard from '../components/ItemCard';
import { IconSearch } from '../components/Icon';

export default function Search() {
  const [params] = useSearchParams();
  const q = params.get('q') || '';
  const { data, error, loading, reload } = useResource(
    q.length >= 2 ? `/search?q=${encodeURIComponent(q)}` : null
  );

  if (q.length < 2) {
    return <EmptyState icon={IconSearch} text="Type at least two characters to search." />;
  }
  if (loading) return <Loading label={`Searching for “${q}”…`} />;
  if (error) return <ErrorState error={error} onRetry={reload} />;

  return (
    <div>
      <h1 className="mb-1 text-2xl font-bold text-slate-900">Search</h1>
      <p className="mb-5 text-sm text-slate-600">
        {data.items.length} result{data.items.length === 1 ? '' : 's'} for “{q}”. Headlines, notes,
        prelims facts, angles and keyword tags are all searched.
      </p>
      {data.items.length === 0 ? (
        <EmptyState icon={IconSearch} text={`Nothing matches “${q}”.`} />
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
