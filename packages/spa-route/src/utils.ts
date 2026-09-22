const searchParamsMatch = (
  searchParamsA: URLSearchParams,
  searchParamsB: URLSearchParams
) => {
  if (searchParamsA.size !== searchParamsB.size) {
    return false;
  }
  for (const [key, value] of searchParamsA.entries()) {
    if (searchParamsB.get(key) !== value) {
      return false;
    }
  }
  return true;
};

export const urlMatchesHref = (
  url: string,
  href: string,
  { ignoreHash = false }: { ignoreHash?: boolean } = {}
) => {
  if (url === href) {
    return true;
  }
  const urlObj = new URL(url, location.origin);
  const hrefObj = new URL(href, location.origin);
  return (
    urlObj.pathname === hrefObj.pathname &&
    searchParamsMatch(urlObj.searchParams, hrefObj.searchParams) &&
    (ignoreHash || urlObj.hash === hrefObj.hash)
  );
};
