import React from "react";

export interface ImageProps extends React.ImgHTMLAttributes<HTMLImageElement> {
  src: string;
  alt: string;
  fill?: boolean;
  priority?: boolean;
  sizes?: string;
}

export default function Image({
  src,
  alt,
  fill,
  priority: _priority,
  sizes: _sizes,
  className = "",
  style,
  ...rest
}: ImageProps) {
  const fillStyle: React.CSSProperties = fill
    ? { position: "absolute", height: "100%", width: "100%", inset: 0, ...style }
    : style || {};
  return (
    <img
      src={src}
      alt={alt}
      className={className}
      style={fillStyle}
      referrerPolicy="no-referrer"
      {...rest}
    />
  );
}
