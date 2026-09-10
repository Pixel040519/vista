// src/components/NewsWidget.jsx
import React from 'react';
import { useNavigate } from 'react-router-dom';
import { announcements } from '../data/announcements';

const NewsWidget = () => {
  const navigate = useNavigate();

  // Same source the Announcements page reads; the widget shows only the newest few.
  const recentPosts = announcements.slice(0, 3);

  return (
    <div className="rounded-2xl border border-slate-200 bg-white/80 dark:border-white/10 dark:bg-[#001f44]/80 p-6 backdrop-blur shadow-sm dark:shadow-lg transition-colors duration-300">
      <div className="mb-6 flex items-center justify-between border-b border-slate-200 dark:border-white/10 pb-4 transition-colors duration-300">
        <h2 className="text-xl font-bold text-slate-900 dark:text-white flex items-center gap-2 transition-colors duration-300">
          <span className="text-blue-600 dark:text-blue-400 transition-colors duration-300">
            {/* Simple FB-style icon */}
            <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 24 24">
              <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.469h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.469h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/>
            </svg>
          </span>
          Latest Updates
        </h2>
        <button 
          onClick={() => navigate('/announcements')}
          className="text-sm font-semibold text-blue-600 hover:text-blue-800 dark:text-yellow-400 dark:hover:text-yellow-300 transition-colors duration-300"
        >
          View All →
        </button>
      </div>

      <div className="space-y-5">
        {recentPosts.map((post) => (
          <div key={post.id} className="group cursor-pointer rounded-xl p-3 transition hover:bg-slate-50 dark:hover:bg-[#002855]">
            <div className="mb-1 flex items-center justify-between">
              <span className="text-xs font-medium text-slate-500 dark:text-slate-400 transition-colors duration-300">
                {post.date}
              </span>
              {post.isPinned && (
                <span className="rounded bg-yellow-100 dark:bg-yellow-500/20 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-yellow-700 dark:text-yellow-400 transition-colors duration-300">
                  Pinned
                </span>
              )}
            </div>
            <h3 className="mb-1 text-base font-bold text-slate-800 dark:text-slate-200 group-hover:text-blue-600 dark:group-hover:text-yellow-400 transition-colors duration-300">
              {post.title}
            </h3>
            <p className="line-clamp-2 text-sm text-slate-600 dark:text-slate-400 transition-colors duration-300">
              {post.excerpt}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
};

export default NewsWidget;