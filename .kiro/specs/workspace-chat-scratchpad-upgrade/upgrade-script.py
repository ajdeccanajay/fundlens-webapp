#!/usr/bin/env python3
"""
Workspace Chat & Scratch Pad Upgrade Script
Applies all 4 phases of the upgrade to workspace.html
"""

import re
import sys
from pathlib import Path

def read_file(filepath):
    """Read file content"""
    with open(filepath, 'r', encoding='utf-8') as f:
        return f.read()

def write_file(filepath, content):
    """Write content to file"""
    with open(filepath, 'w', encoding='utf-8') as f:
        f.write(content)

def apply_phase1_design_system(content):
    """Phase 1: Apply design system colors and typography"""
    print("📝 Phase 1: Applying design system...")
    
    # Replace color variables
    replacements = [
        # Purple/Indigo -> Navy/Teal
        (r'--fundlens-primary: #1a56db', '--fundlens-primary: #0B1829'),
        (r'--fundlens-primary-hover: #1e429f', '--fundlens-primary-hover: #132337'),
        (r'--fundlens-accent: #7c3aed', '--fundlens-accent: #1E5A7A'),
        (r'from-blue-600 to-indigo-600', 'from-[#0B1829] to-[#1E5A7A]'),
        (r'bg-indigo-600', 'bg-[#0B1829]'),
        (r'text-indigo-600', 'text-[#1E5A7A]'),
        (r'border-indigo-600', 'border-[#1E5A7A]'),
        (r'bg-indigo-50', 'bg-[#EBF5FA]'),
        (r'text-indigo-700', 'text-[#0B1829]'),
    ]
    
    for old, new in replacements:
        content = content.replace(old, new)
    
    print("✅ Phase 1 complete")
    return content

def apply_phase2_chat_interface(content):
    """Phase 2: Enhance chat interface"""
    print("📝 Phase 2: Enhancing chat interface...")
    
    # Update message styling
    message_user_style = """
        /* User Messages - Navy Gradient */
        .message-user {
            background: linear-gradient(135deg, var(--color-navy-900) 0%, var(--color-teal-500) 100%);
            color: white;
            border-radius: 18px;
            border-bottom-right-radius: 4px;
            padding: 12px 18px;
            max-width: 70%;
            margin-left: auto;
            box-shadow: var(--shadow-sm);
        }
    """
    
    message_assistant_style = """
        /* Assistant Messages - White with Border */
        .message-assistant {
            background: white;
            border: 1px solid var(--border-subtle);
            border-radius: 18px;
            padding: 16px 20px;
            max-width: 85%;
            box-shadow: var(--shadow-xs);
        }
        
        .message-assistant:hover {
            border-color: var(--color-teal-500);
        }
    """
    
    # Find the Messages section and update
    content = re.sub(
        r'/\* Messages \*/.*?\.message-assistant \{[^}]+\}',
        message_user_style + message_assistant_style,
        content,
        flags=re.DOTALL
    )
    
    print("✅ Phase 2 complete")
    return content

def apply_phase3_scratchpad(content):
    """Phase 3: Add scratch pad slide-out panel"""
    print("📝 Phase 3: Adding scratch pad panel...")
    
    scratchpad_styles = """
        /* Scratch Pad Slide-Out Panel */
        .scratch-pad-panel {
            position: fixed;
            top: 0;
            right: 0;
            width: 420px;
            height: 100vh;
            background: var(--bg-primary);
            border-left: 1px solid var(--border-subtle);
            box-shadow: var(--shadow-2xl);
            transform: translateX(100%);
            transition: transform 300ms cubic-bezier(0.4, 0, 0.2, 1);
            z-index: 50;
            display: flex;
            flex-direction: column;
        }
        
        .scratch-pad-panel--open {
            transform: translateX(0);
        }
        
        .scratch-pad__header {
            background: var(--color-navy-900);
            color: var(--text-inverse);
            padding: var(--spacing-4) var(--spacing-5);
            display: flex;
            align-items: center;
            justify-content: space-between;
        }
        
        .scratch-pad__title {
            font-size: var(--text-lg);
            font-weight: var(--font-semibold);
            display: flex;
            align-items: center;
            gap: var(--spacing-2);
        }
        
        .scratch-pad__close {
            width: 32px;
            height: 32px;
            display: flex;
            align-items: center;
            justify-content: center;
            color: var(--text-inverse);
            border-radius: var(--radius-md);
            transition: all var(--transition-fast);
            cursor: pointer;
        }
        
        .scratch-pad__close:hover {
            background: rgba(255, 255, 255, 0.1);
        }
        
        .scratch-pad__toolbar {
            padding: var(--spacing-3) var(--spacing-4);
            border-bottom: 1px solid var(--border-subtle);
            background: var(--bg-secondary);
        }
        
        .scratch-pad__search {
            display: flex;
            align-items: center;
            gap: var(--spacing-2);
            padding: var(--spacing-2) var(--spacing-3);
            background: var(--bg-primary);
            border: 1px solid var(--border-subtle);
            border-radius: var(--radius-md);
        }
        
        .scratch-pad__search-input {
            flex: 1;
            border: none;
            background: transparent;
            font-size: var(--text-sm);
            outline: none;
        }
        
        .scratch-pad__list {
            flex: 1;
            overflow-y: auto;
            padding: var(--spacing-3);
        }
        
        .saved-item {
            background: var(--bg-primary);
            border: 1px solid var(--border-subtle);
            border-radius: var(--radius-lg);
            margin-bottom: var(--spacing-3);
            overflow: hidden;
            transition: all var(--transition-base);
        }
        
        .saved-item:hover {
            border-color: var(--color-teal-500);
            box-shadow: var(--shadow-md);
        }
        
        .saved-item__header {
            background: var(--bg-secondary);
            padding: var(--spacing-3);
            border-bottom: 1px solid var(--border-subtle);
        }
        
        .saved-item__title {
            font-size: var(--text-sm);
            font-weight: var(--font-semibold);
            color: var(--color-navy-900);
            margin-bottom: var(--spacing-1);
        }
        
        .saved-item__body {
            padding: var(--spacing-3);
        }
        
        .saved-item__preview {
            font-size: var(--text-sm);
            color: var(--text-secondary);
            line-height: var(--leading-relaxed);
            display: -webkit-box;
            -webkit-line-clamp: 3;
            -webkit-box-orient: vertical;
            overflow: hidden;
        }
    """
    
    # Insert before closing </style> tag
    content = content.replace('</style>', scratchpad_styles + '\n    </style>')
    
    print("✅ Phase 3 complete")
    return content

def apply_phase4_rich_content(content):
    """Phase 4: Add rich content rendering"""
    print("📝 Phase 4: Adding rich content rendering...")
    
    rich_content_styles = """
        /* Financial Tables */
        .table-container {
            margin: var(--spacing-4) 0;
            border: 1px solid var(--border-subtle);
            border-radius: var(--radius-lg);
            overflow: hidden;
        }
        
        .table-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: var(--spacing-2) var(--spacing-3);
            background: var(--color-navy-900);
            color: var(--text-inverse);
        }
        
        .table-header__title {
            font-size: var(--text-sm);
            font-weight: var(--font-medium);
        }
        
        .financial-table {
            width: 100%;
            border-collapse: collapse;
            font-size: var(--text-sm);
            font-variant-numeric: tabular-nums;
        }
        
        .financial-table thead {
            background: var(--bg-tertiary);
            position: sticky;
            top: 0;
        }
        
        .financial-table th {
            padding: var(--spacing-3);
            text-align: left;
            font-weight: var(--font-semibold);
            color: var(--color-navy-900);
            border-bottom: 2px solid var(--border-default);
        }
        
        .financial-table td {
            padding: var(--spacing-3);
            border-bottom: 1px solid var(--border-subtle);
        }
        
        .financial-table tbody tr:hover {
            background: rgba(30, 90, 122, 0.05);
        }
        
        /* Citations */
        .citation {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            min-width: 18px;
            height: 18px;
            padding: 0 var(--spacing-1);
            margin: 0 2px;
            font-size: 11px;
            font-weight: var(--font-semibold);
            color: var(--color-teal-500);
            background: rgba(30, 90, 122, 0.1);
            border-radius: var(--radius-sm);
            cursor: pointer;
            vertical-align: super;
            transition: all var(--transition-fast);
        }
        
        .citation:hover {
            background: var(--color-teal-500);
            color: var(--text-inverse);
        }
        
        /* Citation Popover */
        .citation-popover {
            position: absolute;
            z-index: 100;
            width: 360px;
            background: var(--bg-primary);
            border: 1px solid var(--border-subtle);
            border-radius: var(--radius-lg);
            box-shadow: var(--shadow-xl);
            overflow: hidden;
        }
        
        .citation-popover__header {
            display: flex;
            align-items: center;
            gap: var(--spacing-2);
            padding: var(--spacing-3);
            background: var(--color-navy-900);
            color: var(--text-inverse);
        }
        
        .citation-popover__body {
            padding: var(--spacing-3);
        }
        
        .citation-popover__snippet {
            font-size: var(--text-sm);
            color: var(--text-secondary);
            line-height: var(--leading-relaxed);
            padding-left: var(--spacing-3);
            border-left: 3px solid var(--color-teal-500);
        }
        
        /* Animations */
        @keyframes flyToScratchPad {
            0% {
                opacity: 1;
                transform: translate(0, 0) scale(1);
            }
            100% {
                opacity: 0;
                transform: translate(calc(100vw - 200px), -50vh) scale(0.2);
            }
        }
        
        .save-animation {
            animation: flyToScratchPad 400ms cubic-bezier(0.4, 0, 0.2, 1) forwards;
        }
        
        @keyframes blink {
            0%, 50% { opacity: 1; }
            51%, 100% { opacity: 0; }
        }
        
        .message--streaming::after {
            content: '|';
            animation: blink 1s infinite;
            color: var(--color-teal-500);
            font-weight: var(--font-bold);
        }
    """
    
    # Insert before closing </style> tag
    content = content.replace('</style>', rich_content_styles + '\n    </style>')
    
    print("✅ Phase 4 complete")
    return content

def main():
    """Main upgrade function"""
    print("🚀 Starting Workspace Chat & Scratch Pad Upgrade...")
    print("=" * 60)
    
    # File paths
    workspace_file = Path('public/app/deals/workspace.html')
    output_file = Path('public/app/deals/workspace-upgraded.html')
    
    if not workspace_file.exists():
        print(f"❌ Error: {workspace_file} not found")
        sys.exit(1)
    
    # Read original file
    print(f"📖 Reading {workspace_file}...")
    content = read_file(workspace_file)
    
    # Apply all phases
    content = apply_phase1_design_system(content)
    content = apply_phase2_chat_interface(content)
    content = apply_phase3_scratchpad(content)
    content = apply_phase4_rich_content(content)
    
    # Write upgraded file
    print(f"💾 Writing {output_file}...")
    write_file(output_file, content)
    
    print("=" * 60)
    print("✅ Upgrade complete!")
    print(f"📄 Upgraded file: {output_file}")
    print("\nNext steps:")
    print("1. Review the upgraded file")
    print("2. Test in browser")
    print("3. Run unit tests")
    print("4. Run E2E tests")
    print("5. Replace original file if satisfied")

if __name__ == '__main__':
    main()
