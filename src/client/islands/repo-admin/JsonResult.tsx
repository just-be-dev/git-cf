export function JsonResult({ data }: { data: unknown }) {
  return (
    <div className="mt-2">
      <pre className="overflow-x-auto rounded-xl bg-zinc-100 p-4 text-sm dark:bg-zinc-800">
        {JSON.stringify(data, null, 2)}
      </pre>
    </div>
  );
}
