type Selector = {name: string; filter: string};
export function statusCountParams(filters: Selector, status: string): URLSearchParams {
  const params = new URLSearchParams({status});
  if (filters.name) params.set("name", filters.name);
  if (filters.filter) params.set("filter", filters.filter);
  return params;
}
