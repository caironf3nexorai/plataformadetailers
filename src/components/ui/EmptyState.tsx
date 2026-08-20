import React from 'react';

interface EmptyStateProps {
  title: string;
  description: string;
  icon?: React.ReactNode;
}

export const EmptyState: React.FC<EmptyStateProps> = ({ title, description, icon }) => {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
      {icon && (
        <div className="mb-4 text-vapor-600">
          {icon}
        </div>
      )}
      <h3 className="font-display text-[16px] text-vapor-100 mb-2">
        {title}
      </h3>
      <p className="font-sans text-[14px] text-vapor-400 max-w-sm">
        {description}
      </p>
    </div>
  );
};
