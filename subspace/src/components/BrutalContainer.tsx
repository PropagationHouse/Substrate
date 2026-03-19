import React from 'react';
import { cn } from '@/lib/utils';

interface BrutalContainerProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
  title?: string;
  processing?: boolean;
  className?: string;
}

export const BrutalContainer = ({ 
  children, 
  className, 
  title, 
  processing = false,
  ...props 
}: BrutalContainerProps) => {
  return (
    <div 
      className={cn(
        "glass-panel relative transition-all duration-300 rounded-none overflow-hidden",
        processing ? "border-subspace-green/60 shadow-[0_0_15px_rgba(74,222,128,0.2)]" : "border-subspace-white/50",
        className
      )} 
      {...props}
    >
      {title && (
        <div className={cn(
          "absolute -top-3 left-4 px-2 font-mono text-[10px] uppercase tracking-widest transition-colors duration-300 backdrop-blur-md border border-subspace-white/20 rounded-none",
          processing ? "text-subspace-green bg-subspace-black" : "text-subspace-gray bg-subspace-black"
        )}>
          {title}
        </div>
      )}
      {children}
      
      {/* Corner accents - Adjusted for rounded corners */}
      <div className={cn("absolute top-2 left-2 w-2 h-2 border-t border-l rounded-tl-sm transition-colors duration-300", processing ? "border-subspace-green" : "border-subspace-white/20")} />
      <div className={cn("absolute top-2 right-2 w-2 h-2 border-t border-r rounded-tr-sm transition-colors duration-300", processing ? "border-subspace-green" : "border-subspace-white/20")} />
      <div className={cn("absolute bottom-2 left-2 w-2 h-2 border-b border-l rounded-bl-sm transition-colors duration-300", processing ? "border-subspace-green" : "border-subspace-white/20")} />
      <div className={cn("absolute bottom-2 right-2 w-2 h-2 border-b border-r rounded-br-sm transition-colors duration-300", processing ? "border-subspace-green" : "border-subspace-white/20")} />
    </div>
  );
};
