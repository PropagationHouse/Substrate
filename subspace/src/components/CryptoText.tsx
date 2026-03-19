import React, { useState, useEffect, useRef } from 'react';

const CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789@#$%&";

interface CryptoTextProps {
  text: string;
  className?: string;
  speed?: number;
}

export const CryptoText = ({ text, className, speed = 30 }: CryptoTextProps) => {
  const [display, setDisplay] = useState(text);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const iterations = useRef(0);

  useEffect(() => {
    iterations.current = 0;
    
    if (intervalRef.current) clearInterval(intervalRef.current);

    intervalRef.current = setInterval(() => {
      setDisplay(prev => 
        text.split("").map((char, index) => {
          if (index < iterations.current) {
            return text[index];
          }
          return CHARS[Math.floor(Math.random() * CHARS.length)];
        }).join("")
      );

      if (iterations.current >= text.length) {
        if (intervalRef.current) clearInterval(intervalRef.current);
      }
      
      iterations.current += 1 / 3; // Slower reveal
    }, speed);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [text, speed]);

  return <span className={className}>{display}</span>;
};
