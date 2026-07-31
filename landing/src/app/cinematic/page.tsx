'use client';

import { Calendar, ChevronLeft, ChevronRight, Clock, Menu, Play, Search, Star, User, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

/* Literal build of the cinematic reference spec — movie copy and all.
   A judging surface for the look; the fpay re-skin is a second pass. */

const NAV_LINKS = ['Movies', 'TV Series', "Editor's Pick", 'Interviews', 'User Reviews'];

const glassPill = 'liquid-glass flex items-center gap-2 rounded-full';

export default function CinematicPage() {
  const [open, setOpen] = useState(false);
  const video = useRef<HTMLVideoElement>(null);

  // Playback starts here rather than via autoPlay so reduced-motion is honoured
  // before the first frame moves — flipping autoPlay after mount wouldn't pause it.
  useEffect(() => {
    if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
      // Rejects if a browser blocks playback anyway — the poster frame stands in.
      video.current?.play().catch(() => {});
    }
  }, []);

  return (
    <div className="font-inter relative flex h-[100svh] flex-col overflow-hidden bg-black text-white">
      <video
        ref={video}
        className="fixed inset-0 z-0 h-full w-full object-cover"
        src="/hero.mp4"
        poster="/hero-poster.jpg"
        loop
        muted
        playsInline
        preload="auto"
        aria-hidden
      />
      <div className="blur-fade-mask pointer-events-none fixed inset-0 z-[1]" />

      <header className="relative z-50 flex items-center justify-between px-4 py-4 sm:px-6 md:px-12 md:py-6">
        <span
          className="animate-blur-fade-up flex h-8 items-center text-xl font-semibold tracking-[-0.04em] md:h-10 md:text-2xl"
          style={{ animationDelay: '0ms' }}
        >
          CINEMATIC
        </span>

        <nav className="hidden items-center gap-8 lg:flex">
          {NAV_LINKS.map((link, i) => (
            <a
              key={link}
              href="#"
              className="animate-blur-fade-up text-sm transition-colors hover:text-gray-300"
              style={{ animationDelay: `${100 + i * 50}ms` }}
            >
              {link}
            </a>
          ))}
        </nav>

        <div className="flex items-center gap-3">
          <button
            className={`${glassPill} animate-blur-fade-up hidden px-4 py-2 text-sm sm:flex md:px-6`}
            style={{ animationDelay: '350ms' }}
          >
            Search
            <Search size={18} />
          </button>
          <button
            aria-label="Account"
            className={`${glassPill} animate-blur-fade-up hidden h-10 w-10 justify-center sm:flex`}
            style={{ animationDelay: '400ms' }}
          >
            <User size={18} />
          </button>
          <button
            onClick={() => setOpen((v) => !v)}
            aria-label={open ? 'Close menu' : 'Open menu'}
            aria-expanded={open}
            className={`${glassPill} animate-blur-fade-up h-10 w-10 justify-center lg:hidden`}
            style={{ animationDelay: '350ms' }}
          >
            <Menu
              size={18}
              className={`absolute transition-all duration-500 ease-out ${open ? 'rotate-180 scale-50 opacity-0' : 'scale-100 opacity-100'}`}
            />
            <X
              size={18}
              className={`absolute transition-all duration-500 ease-out ${open ? 'scale-100 opacity-100' : '-rotate-180 scale-50 opacity-0'}`}
            />
          </button>
        </div>
      </header>

      <div
        className={`absolute inset-x-0 top-[72px] z-40 border-t border-b border-gray-800 bg-gray-900/95 shadow-2xl backdrop-blur-lg transition-all duration-500 ease-out lg:hidden ${
          open ? 'translate-y-0 opacity-100' : 'pointer-events-none -translate-y-4 opacity-0'
        }`}
      >
        <div className="flex flex-col px-4 py-3 sm:px-6">
          {NAV_LINKS.map((link, i) => (
            <a
              key={link}
              href="#"
              onClick={() => setOpen(false)}
              className={`rounded-lg px-3 py-3 transition-all duration-500 ease-out hover:bg-gray-800/50 ${
                open ? 'translate-x-0 opacity-100' : '-translate-x-4 opacity-0'
              }`}
              style={{ transitionDelay: `${i * 50}ms` }}
            >
              {link}
            </a>
          ))}
        </div>

        <div className="flex items-center gap-3 border-t border-gray-800 px-4 py-4 sm:hidden">
          <button className={`${glassPill} flex-1 justify-center px-4 py-2 text-sm`}>
            Search
            <Search size={18} />
          </button>
          <button aria-label="Account" className={`${glassPill} h-10 w-10 justify-center`}>
            <User size={18} />
          </button>
        </div>
      </div>

      <div className="relative z-10 flex flex-1 flex-col justify-end px-4 pb-8 sm:px-6 md:px-12 md:pb-16">
        <div className="flex flex-col items-start gap-8 md:flex-row md:items-end">
          <div className="flex-1">
            <div
              className="animate-blur-fade-up mb-6 flex flex-wrap items-center gap-3 text-xs sm:gap-6 sm:text-sm md:mb-8"
              style={{ animationDelay: '300ms' }}
            >
              <span className="flex items-center gap-2">
                <Star size={16} className="fill-white sm:h-5 sm:w-5" />
                <span className="font-medium">8.7/10 IMDB</span>
              </span>
              <span className="flex items-center gap-2">
                <Clock size={16} />
                132 min
              </span>
              <span className="flex items-center gap-2">
                <Calendar size={16} />
                April, 2025
              </span>
            </div>

            <h1
              className="animate-blur-fade-up mb-4 text-3xl font-normal tracking-[-0.04em] sm:text-5xl md:mb-6 md:text-6xl lg:text-7xl"
              style={{ animationDelay: '400ms' }}
            >
              Step Through. Work Smarter.
            </h1>

            <p
              className="animate-blur-fade-up mb-6 max-w-2xl text-base text-gray-400 sm:text-lg md:mb-12 md:text-xl"
              style={{ animationDelay: '500ms' }}
            >
              A voyage through forgotten realms, where past and future intertwine.
            </p>

            <div className="flex flex-wrap gap-3 sm:gap-4">
              <button
                className="animate-blur-fade-up flex items-center gap-2 rounded-full bg-white px-6 py-2.5 font-medium text-black transition-colors hover:bg-gray-200 sm:px-8 sm:py-3"
                style={{ animationDelay: '600ms' }}
              >
                <Play size={18} className="fill-black" />
                Watch Now
              </button>
              <button
                className={`${glassPill} animate-blur-fade-up px-6 py-2.5 font-medium sm:px-8 sm:py-3`}
                style={{ animationDelay: '700ms' }}
              >
                Learn More
              </button>
            </div>
          </div>

          <div className="flex gap-3 sm:gap-4">
            <button
              className={`${glassPill} animate-blur-fade-up px-4 py-2.5 sm:px-6 sm:py-3`}
              style={{ animationDelay: '800ms' }}
            >
              <ChevronLeft size={18} />
              Previous
            </button>
            <button
              className={`${glassPill} animate-blur-fade-up px-4 py-2.5 sm:px-6 sm:py-3`}
              style={{ animationDelay: '900ms' }}
            >
              Next
              <ChevronRight size={18} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
