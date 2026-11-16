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
              onclick="${goFn}(${cur - 1})" aria-label="Previous page">Back</button>
      <div class="pagination-page-group">
        <span class="pagination-label">Page</span>
        <select class="pagination-select" onchange="${goFn}(parseInt(this.value, 10))" aria-label="Current page">${opts}</select>
        <span class="pagination-of">of ${totalPages}</span>
      </div>
      <button type="button" class="pagination-nav-btn" ${cur >= totalPages ? "disabled" : ""}
              onclick="${goFn}(${cur + 1})" aria-label="Next page">Next</button>`;
    return cur;
}
