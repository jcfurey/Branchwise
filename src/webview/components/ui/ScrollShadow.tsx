/**
 * A soft shade along the top of the window once the page has scrolled. It costs nothing at run
 * time: `animate-scroll-shadow` in `styles.css` ties its opacity to the page's scroll position.
 */
export function ScrollShadow() {
  return (
    <div
      aria-hidden="true"
      class="pointer-events-none fixed inset-x-0 top-0 z-1 h-0 shadow-scroll animate-scroll-shadow"
    />
  );
}
