import { IconSpinner } from './Icon';

export default function Loading({ label = 'Loading…' }) {
  return (
    <div className="flex items-center justify-center gap-2 p-10 text-slate-600 text-sm">
      <IconSpinner className="text-lg" />
      {label}
    </div>
  );
}
