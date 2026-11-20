"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import styles from "./ImageWithLightbox.module.css";
import { scopedClasses } from "@/lib/styles";
import { getSitePhoto, sitePhotoSizes } from "@/lib/site-photos";

interface Props extends React.ImgHTMLAttributes<HTMLImageElement> {
  containerClassName?: string;
  onOpenChange?: (open: boolean) => void;
}

export default function ImageWithLightbox({
  className,
  containerClassName = "",
  src,
  alt,
  srcSet,
  sizes,
  width,
  height,
  loading = "lazy",
  decoding = "async",
  onOpenChange,
  ...props
}: Props) {
  const [isOpen, setIsOpen] = useState(false);
  const triggerRef = useRef<HTMLImageElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const photo = getSitePhoto(src);

  const openLightbox = () => {
    setIsOpen(true);
    onOpenChange?.(true);
  };
  const closeLightbox = useCallback(() => {
    setIsOpen(false);
    onOpenChange?.(false);
    triggerRef.current?.focus({ preventScroll: true });
  }, [onOpenChange]);

  useEffect(() => {
    if (!isOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus({ preventScroll: true });
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeLightbox();
      // The close button is the dialog's only interactive element.
      if (event.key === "Tab") {
        event.preventDefault();
        closeRef.current?.focus();
      }
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [isOpen, closeLightbox]);

  return (
    <div className={`${styles["image-container"]} ${containerClassName}`}>
      <img
        {...props}
        ref={triggerRef}
        src={photo?.src ?? src}
        srcSet={photo?.srcSet ?? srcSet}
        sizes={sizes ?? (photo ? sitePhotoSizes : undefined)}
        width={width ?? photo?.width}
        height={height ?? photo?.height}
        loading={loading}
        decoding={decoding}
        alt={alt}
        className={scopedClasses(styles, `${className} lightbox-trigger`)}
        tabIndex={0}
        role="button"
        aria-label={"Enlarge " + alt}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            openLightbox();
          }
        }}
        onClick={openLightbox}
      />

      {isOpen &&
        createPortal(
          <div
            className={scopedClasses(styles, "lightbox-overlay")}
            role="dialog"
            aria-modal="true"
            aria-label={"Enlarged " + alt}
            onClick={closeLightbox}
          >
            <div className={scopedClasses(styles, "lightbox-content")}>
              <button
                ref={closeRef}
                type="button"
                className={scopedClasses(styles, "lightbox-close")}
                aria-label="Close enlarged image"
                onClick={(event) => {
                  event.stopPropagation();
                  closeLightbox();
                }}
              >
                &times;
              </button>
              <img
                src={photo?.lightbox.src ?? src}
                width={photo?.lightbox.width}
                height={photo?.lightbox.height}
                decoding="async"
                alt={alt}
                className={scopedClasses(styles, "lightbox-img")}
                onClick={(e) => e.stopPropagation()}
              />
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
