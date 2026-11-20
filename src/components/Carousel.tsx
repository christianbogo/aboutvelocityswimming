"use client";

import { useState, useEffect, useRef } from "react";
import ImageWithLightbox from "./ImageWithLightbox";
import styles from "./Carousel.module.css";

interface CarouselProps {
  images: string[];
  autoPlayInterval?: number;
  altPrefix?: string;
  className?: string;
}

export default function Carousel({
  images,
  autoPlayInterval = 4000,
  altPrefix = "Velocity Image",
  className = "",
}: CarouselProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isLightboxOpen, setIsLightboxOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const imageCount = images.length;

  useEffect(() => {
    const container = containerRef.current;
    if (!container || imageCount < 2 || autoPlayInterval <= 0) return;

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let isVisible = false;
    let timer: ReturnType<typeof setInterval> | undefined;

    const updateAutoplay = () => {
      clearInterval(timer);
      timer = undefined;
      if (
        !isVisible ||
        document.hidden ||
        reducedMotion.matches ||
        isLightboxOpen
      ) {
        return;
      }

      timer = setInterval(() => {
        // Give slow connections time to finish the current slide before advancing.
        const image = container.querySelector("img");
        if (image?.complete && image.naturalWidth > 0) {
          setCurrentIndex((prev) => (prev + 1) % imageCount);
        }
      }, autoPlayInterval);
    };

    const observer = new IntersectionObserver(([entry]) => {
      if (isVisible !== entry.isIntersecting) {
        isVisible = entry.isIntersecting;
        updateAutoplay();
      }
    });
    observer.observe(container);
    document.addEventListener("visibilitychange", updateAutoplay);
    reducedMotion.addEventListener("change", updateAutoplay);

    return () => {
      clearInterval(timer);
      observer.disconnect();
      document.removeEventListener("visibilitychange", updateAutoplay);
      reducedMotion.removeEventListener("change", updateAutoplay);
    };
  }, [imageCount, autoPlayInterval, isLightboxOpen]);

  if (!images || images.length === 0) {
    return null;
  }

  const nextSlide = () => setCurrentIndex((prev) => (prev + 1) % images.length);
  const prevSlide = () =>
    setCurrentIndex((prev) => (prev - 1 + images.length) % images.length);

  return (
    <div
      ref={containerRef}
      className={`${styles["carousel-container"]} ${className}`}
    >
      <ImageWithLightbox
        src={images[currentIndex]}
        alt={`${altPrefix} ${currentIndex + 1}`}
        className={styles["carousel-img"]}
        onOpenChange={setIsLightboxOpen}
      />

      {images.length > 1 && (
        <div className={styles["carousel-controls"]}>
          <button
            onClick={prevSlide}
            className={styles["carousel-btn"]}
            aria-label="Previous image"
          >
            &larr;
          </button>
          <div className={styles["carousel-dots"]}>
            {images.map((_, idx) => (
              <button
                key={idx}
                className={`${styles["carousel-dot"]} ${idx === currentIndex ? styles.active : ""}`}
                aria-current={idx === currentIndex ? "true" : undefined}
                onClick={() => setCurrentIndex(idx)}
                aria-label={`Go to slide ${idx + 1}`}
              />
            ))}
          </div>
          <button
            onClick={nextSlide}
            className={styles["carousel-btn"]}
            aria-label="Next image"
          >
            &rarr;
          </button>
        </div>
      )}
      <div className={styles["accent-blob"]}></div>
    </div>
  );
}
