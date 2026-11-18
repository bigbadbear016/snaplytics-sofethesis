// scripts/pager.js – shared client-side Back / Page / Next control.
/** Back / Page x of y / Next, same look as Customer Data. Returns the clamped page. */
function renderPager(elId, page, totalItems, perPage, goFn) {
    const el = document.getElementById(elId);
    const totalPages = Math.max(1, Math.ceil(totalItems / perPage));
    const cur = Math.min(Math.max(1, page), totalPages);
    if (!el) return cur;
    if (totalPages <= 1) {
        el.innerHTML = "";
        return cur;
    }
    let opts = "";
    for (let i = 1; i <= totalPages; i++) {
        opts += `<option value="${i}" ${i === cur ? "selected" : ""}>${i}</option>`;
    }
    el.innerHTML = `
      <button type="button" class="pagination-nav-btn" ${cur <= 1 ? "disabled" : ""}
              onclick="${goFn}(${cur - 1})" aria-label="Previous page"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg><span>Back</span></button>
      <div class="pagination-page-group">
        <span class="pagination-label">Page</span>
        <select class="pagination-select" onchange="${goFn}(parseInt(this.value, 10))" aria-label="Current page">${opts}</select>
        <span class="pagination-of">of ${totalPages}</span>
      </div>
      <button type="button" class="pagination-nav-btn pagination-nav-btn--next" ${cur >= totalPages ? "disabled" : ""}
              onclick="${goFn}(${cur + 1})" aria-label="Next page"><span>Next</span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 18l6-6-6-6"/></svg></button>`;
    return cur;
}
