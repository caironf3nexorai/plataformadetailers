import React from 'react';

interface PageHeaderProps {
  title: string;
  action?: React.ReactNode;
}

export const PageHeader: React.FC<PageHeaderProps> = ({ title, action }) => {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
      <h2 className="font-display text-[24px] text-vapor-100 uppercase tracking-wide hidden lg:block">
        {title}
      </h2>
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
