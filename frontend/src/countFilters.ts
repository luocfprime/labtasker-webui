type Selector = {name: string; filter: string; route?: string};
export function statusCountParams(filters: Selector, status: string): URLSearchParams {
  const params = new URLSearchParams({status});
  if (filters.name) params.set("name_fuzzy", filters.name);
  const expression = effectiveTaskFilter(filters);
  if (expression) params.set("filter", expression);
  return params;
}

export function effectiveTaskFilter(filters: {filter: string; route?: string}): string {
  const route = filters.route ? `${JSON.stringify(filters.route)} in routes` : "";
  return filters.filter && route ? `(${filters.filter}) and (${route})` : filters.filter || route;
}
