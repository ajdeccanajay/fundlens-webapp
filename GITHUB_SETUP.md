# GitHub Setup Instructions

## Quick Setup (After Creating GitHub Repository)

Replace `YOUR_USERNAME` and `YOUR_REPO_NAME` with your actual GitHub username and repository name:

```bash
# Add GitHub as remote origin
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO_NAME.git

# Verify the remote was added
git remote -v

# Push your code to GitHub (first time)
git push -u origin master

# Or if GitHub created a 'main' branch by default:
git branch -M main
git push -u origin main
```

## Alternative: Using SSH (More Secure)

If you have SSH keys set up with GitHub:

```bash
git remote add origin git@github.com:YOUR_USERNAME/YOUR_REPO_NAME.git
git push -u origin master
```

## Verify Your Initial Commit

Your initial commit includes:
- ✅ All source code (backend + frontend)
- ✅ Python parser service
- ✅ Database schema and migrations
- ✅ Infrastructure configuration
- ✅ Documentation files
- ❌ Environment files (excluded via .gitignore)
- ❌ Database files (excluded via .gitignore)
- ❌ node_modules (excluded via .gitignore)
- ❌ Logs and backups (excluded via .gitignore)

## Future Workflow

After the initial push, your daily workflow will be:

```bash
# Check status
git status

# Stage changes
git add .

# Commit with message
git commit -m "Your commit message"

# Push to GitHub
git push
```

## Branch Strategy (Optional)

For safer development:

```bash
# Create a development branch
git checkout -b develop

# Make changes, commit, and push
git push -u origin develop

# When ready to merge to master:
git checkout master
git merge develop
git push
```

## Important Notes

1. **Never commit .env files** - They're already in .gitignore
2. **Database files are excluded** - Each environment has its own database
3. **Backup files are excluded** - Only working code is tracked
4. **node_modules is excluded** - Dependencies are installed via package.json

## Current Repository State

- Initial commit created: ✅
- Commit message: "Initial commit: Working FundLens application with workspace, research assistant, and pipeline features"
- Files tracked: All application code, configs, and documentation
- Files excluded: Sensitive data, dependencies, build artifacts, logs

## Troubleshooting

If you get authentication errors:
1. Use a Personal Access Token instead of password
2. Generate token at: https://github.com/settings/tokens
3. Use token as password when prompted

If you need to change remote URL:
```bash
git remote set-url origin NEW_URL
```
