import React from 'react';
import { Outlet } from 'react-router-dom';
import { SidebarNav } from './SidebarNav';
import { BottomNav } from './BottomNav';
import { TopBar } from './TopBar';
import { BotaoFeedbackFlutuante } from '../feedback/BotaoFeedbackFlutuante';

export const AppShell: React.FC = () => {
  return (
    <div className="min-h-screen bg-graphite-900 text-vapor-100 flex w-full max-w-full">
      <SidebarNav />
      
      <div className="flex-1 flex flex-col min-h-screen lg:pl-[240px] w-full max-w-full">
        <TopBar />
        
        <main className="flex-1 p-4 pt-[80px] pb-[80px] lg:p-8 lg:pt-8 w-full max-w-5xl mx-auto">
          <Outlet />
        </main>
        
        <BottomNav />
        <BotaoFeedbackFlutuante />
      </div>
    </div>
  );
};
