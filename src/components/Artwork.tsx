/* eslint-disable @next/next/no-img-element */

/**
 * Sign artwork.
 *
 * Plain `<img>` rather than `next/image`: these are SVGs served from `public/`,
 * so there is nothing to optimise, and the intrinsic-size handling of
 * `next/image` would introduce the layout shift this is meant to avoid.
 *
 * The white plate is deliberate. The artwork is line work drawn for print, so on
 * a dark background the strokes vanish.
 */
export default function Artwork({
  src,
  alt,
  large = false,
}: {
  src: string;
  alt: string;
  large?: boolean;
}) {
  return (
    <div
      className={`artwork-plate flex items-center justify-center overflow-hidden border border-line ${
        large ? "min-h-40 p-3" : "h-16 w-24 shrink-0 p-1.5"
      }`}
    >
      <img
        src={src}
        alt={alt}
        className={large ? "max-h-64 w-auto max-w-full" : "max-h-full w-auto max-w-full"}
      />
    </div>
  );
}
