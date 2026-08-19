import React, { useRef } from 'react';
import { motion, useInView } from 'framer-motion';

export interface Segment {
  text: string;
  className?: string;
}

interface WordsPullUpMultiStyleProps {
  segments: Segment[];
  className?: string;
}

export function WordsPullUpMultiStyle({ segments, className = '' }: WordsPullUpMultiStyleProps) {
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true, margin: '-50px' });
  let globalWordIndex = 0;

  return (
    <div ref={ref} className={`inline-flex flex-wrap justify-center ${className}`}>
      {segments.map((seg, segIdx) => {
        const words = seg.text.split(' ').filter((w) => w.length > 0);
        return (
          <React.Fragment key={segIdx}>
            {words.map((word, wIdx) => {
              const currentIdx = globalWordIndex++;
              return (
                <motion.span
                  key={`${segIdx}-${wIdx}`}
                  initial={{ y: 20, opacity: 0 }}
                  animate={isInView ? { y: 0, opacity: 1 } : { y: 20, opacity: 0 }}
                  transition={{
                    delay: currentIdx * 0.08,
                    duration: 0.5,
                    ease: [0.16, 1, 0.3, 1],
                  }}
                  className={`inline-block mr-[0.25em] ${seg.className || ''}`}
                >
                  {word}
                </motion.span>
              );
            })}
          </React.Fragment>
        );
      })}
    </div>
  );
}
