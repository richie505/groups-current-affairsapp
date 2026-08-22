// Consistent "nothing here yet" placeholder — used instead of a bare
// paragraph so empty lists read as an intentional state, not a broken page.
export default function EmptyState({ icon: Icon, text, action }) {
  return (
    <div className="text-center bg-surface border border-dashed border-slate-200 rounded-xl px-6 py-10 text-slate-500">
      {Icon && (
        <div className="mx-auto mb-3 w-10 h-10 rounded-full bg-slate-100 text-slate-600 flex items-center justify-center text-xl">
          <Icon />
        </div>
      )}
      <p className="text-sm">{text}</p>
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}
