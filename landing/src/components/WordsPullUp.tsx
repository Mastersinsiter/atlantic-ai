import { useRef } from 'react';
import { motion, useInView } from 'framer-motion';

interface WordsPullUpProps {
  text: string;
  className?: string;
  showTimecode?: boolean;
}

export function WordsPullUp({ text, className = '', showTimecode = false }: WordsPullUpProps) {
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true, margin: '-50px' });
  const words = text.split(' ');

  return (
    <div ref={ref} className={`flex flex-wrap justify-center ${className}`}>
      {words.map((word, i) => (
        <motion.span
          key={i}
          initial={{ y: 20, opacity: 0 }}
          animate={isInView ? { y: 0, opacity: 1 } : { y: 20, opacity: 0 }}
          transition={{
            delay: i * 0.08,
            duration: 0.5,
            ease: [0.16, 1, 0.3, 1],
          }}
          className="inline-block mr-[0.25em] relative"
        >
          {word}
          {showTimecode && i === words.length - 1 && (
            <span className="absolute top-[0.55em] -right-[1.4em] text-[0.14em] font-serif text-primary tracking-normal">
              00:00:01:12
            </span>
          )}
        </motion.span>
      ))}
    </div>
  );
}
