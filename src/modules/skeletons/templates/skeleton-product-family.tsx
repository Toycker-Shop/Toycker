const SkeletonProductFamily = () => {
  const block = "animate-pulse rounded bg-slate-200"

  return (
    <section
      className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
      aria-label="Loading Product Family"
      data-testid="product-family-skeleton"
    >
      <div className="mb-4">
        <div className={`${block} h-6 w-36`} />
        <div className={`${block} mt-2 h-4 w-64 max-w-full`} />
      </div>

      <div className="mb-3 flex justify-end gap-2">
        <div className={`${block} h-8 w-8 rounded-full`} />
        <div className={`${block} h-8 w-8 rounded-full`} />
      </div>

      <div className="-ml-3 flex overflow-hidden">
        {[0, 1, 2].map((item) => (
          <div
            key={item}
            className="min-w-0 flex-[0_0_50%] pl-3 sm:flex-[0_0_33.333%]"
          >
            <div className="rounded-xl border border-slate-100 bg-slate-50/40 p-2 sm:p-2.5">
              <div className={`${block} aspect-square w-full rounded-2xl`} />
              <div className={`${block} mt-3 h-4 w-4/5`} />
              <div className={`${block} mt-2 h-5 w-3/5`} />
              <div className={`${block} mt-2 h-4 w-4/5`} />
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}

export default SkeletonProductFamily