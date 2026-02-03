/**
 * FundLens.ai Theme Toggle
 * Handles light/dark mode switching with localStorage persistence
 */

(function() {
  'use strict';

  // Get HTML element
  const html = document.documentElement;
  
  // Load saved theme or default to light
  const savedTheme = localStorage.getItem('fundlens-theme') || 'light';
  html.setAttribute('data-theme', savedTheme);
  
  // Initialize theme toggle button when DOM is ready
  function initThemeToggle() {
    const themeToggle = document.getElementById('theme-toggle');
    
    if (!themeToggle) {
      console.warn('Theme toggle button not found. Add id="theme-toggle" to your toggle button.');
      return;
    }
    
    // Update button icon based on current theme
    updateThemeIcon(savedTheme);
    
    // Add click handler
    themeToggle.addEventListener('click', toggleTheme);
  }
  
  // Toggle between light and dark themes
  function toggleTheme() {
    const currentTheme = html.getAttribute('data-theme');
    const newTheme = currentTheme === 'light' ? 'dark' : 'light';
    
    // Update DOM
    html.setAttribute('data-theme', newTheme);
    
    // Save to localStorage
    localStorage.setItem('fundlens-theme', newTheme);
    
    // Update icon
    updateThemeIcon(newTheme);
    
    // Dispatch custom event for other scripts to listen to
    window.dispatchEvent(new CustomEvent('themechange', { 
      detail: { theme: newTheme } 
    }));
  }
  
  // Update theme toggle button icon
  function updateThemeIcon(theme) {
    const themeToggle = document.getElementById('theme-toggle');
    if (!themeToggle) return;
    
    const lightIcon = themeToggle.querySelector('.theme-icon-light');
    const darkIcon = themeToggle.querySelector('.theme-icon-dark');
    
    if (lightIcon && darkIcon) {
      if (theme === 'light') {
        lightIcon.style.display = 'none';
        darkIcon.style.display = 'block';
      } else {
        lightIcon.style.display = 'block';
        darkIcon.style.display = 'none';
      }
    }
    
    // Update aria-label for accessibility
    themeToggle.setAttribute('aria-label', 
      theme === 'light' ? 'Switch to dark mode' : 'Switch to light mode'
    );
  }
  
  // Initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initThemeToggle);
  } else {
    initThemeToggle();
  }
  
  // Expose toggle function globally for manual triggering
  window.FundLensTheme = {
    toggle: toggleTheme,
    get: () => html.getAttribute('data-theme'),
    set: (theme) => {
      if (theme === 'light' || theme === 'dark') {
        html.setAttribute('data-theme', theme);
        localStorage.setItem('fundlens-theme', theme);
        updateThemeIcon(theme);
      }
    }
  };
})();
