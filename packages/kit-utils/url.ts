export function jsonToSearchParams(json) {
  const params = new URLSearchParams();
  Object.entries(json).forEach(([key, value]) => {
    if ([undefined, null].includes(value as undefined)) {
      params.append(key, "");
    } else if (typeof value === "object") {
      // URLSearchParams encodes on toString(); no extra encode here
      params.append(key, JSON.stringify(value));
    } else {
      params.append(key, String(value));
    }
  });
  return params;
}

export function mergeSearchParams(
  baseParams: URLSearchParams,
  newParams: URLSearchParams
) {
  const merged = new URLSearchParams(baseParams);
  for (const [key, value] of newParams.entries()) {
    if (merged.has(key)) {
      merged.set(key, value);
    } else {
      merged.append(key, value);
    }
  }
  return merged;
}

export function mergeSearchParamsIntoUrl(
  url: string,
  newParams: URLSearchParams
): string {
  const urlObj = new URL(url, window.location.origin);
  const mergedParams = mergeSearchParams(urlObj.searchParams, newParams);
  urlObj.search = mergedParams.toString();
  return urlObj.toString();
}
