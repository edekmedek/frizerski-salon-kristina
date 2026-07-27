export function isTabletViewport(
  matchMedia: (query: string) => Pick<MediaQueryList, 'matches'> = window.matchMedia.bind(window),
) {
  return matchMedia('(min-width: 700px) and (max-width: 1366px) and (pointer: coarse)').matches
}
