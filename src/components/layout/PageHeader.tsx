import React from 'react';

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  description?: string;
  action?: React.ReactNode;
}

export const PageHeader: React.FC<PageHeaderProps> = ({ title, subtitle, description, action }) => {
  const subText = subtitle || description;
  return (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
      <div>
        <h2 className="font-display text-[24px] text-vapor-100 uppercase tracking-wide hidden lg:block">
          {title}
        </h2>
        {subText && (
          <p className="font-sans text-[13px] text-vapor-400 mt-0.5 hidden lg:block">
            {subText}
          </p>
        )}
      </div>
      {/* Spacer para mobile já que o TopBar tem o title */}
      <div className="lg:hidden h-2" />
      {action && (
        <div className="flex-shrink-0">
          {action}
        </div>
      )}
    </div>
  );
};
