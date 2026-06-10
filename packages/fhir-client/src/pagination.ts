import type { FhirBundle, FhirResource } from "./types";

/**
 * Extract the "next" page URL from a FHIR Bundle's link array.
 */
export function getNextPageUrl(bundle: FhirBundle): string | null {
  const nextLink = bundle.link?.find((l) => l.relation === "next");
  return nextLink?.url ?? null;
}

/**
 * Async generator that iterates over all pages of a FHIR Bundle search result.
 * Caller provides a fetchPage function that fetches a bundle given a URL.
 */
export async function* iteratePages<T extends FhirResource>(
  firstPageUrl: string,
  fetchPage: (url: string) => Promise<FhirBundle<T>>,
): AsyncGenerator<T> {
  let url: string | null = firstPageUrl;

  while (url !== null) {
    const bundle = await fetchPage(url);

    for (const entry of bundle.entry ?? []) {
      if (entry.resource) {
        yield entry.resource;
      }
    }

    url = getNextPageUrl(bundle);
  }
}

/**
 * Collect all resources from a paginated search into an array.
 * Use only for moderate result sets — for large sets prefer iteratePages.
 */
export async function collectPages<T extends FhirResource>(
  firstPageUrl: string,
  fetchPage: (url: string) => Promise<FhirBundle<T>>,
  maxPages = 100,
): Promise<readonly T[]> {
  const results: T[] = [];
  let pageCount = 0;

  for await (const resource of iteratePages(firstPageUrl, fetchPage)) {
    results.push(resource);
    // Safety: increment page count at bundle boundaries handled in generator,
    // but we apply maxPages as a backstop via total resource count
    if (results.length >= maxPages * 20) break;
    pageCount++;
    if (pageCount >= maxPages * 20) break;
  }

  return results;
}
