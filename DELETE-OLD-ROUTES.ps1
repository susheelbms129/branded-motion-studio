# Run ONCE from your project root (PowerShell), after unzipping. Removes the old /app route files.
Remove-Item -LiteralPath 'src/routes/app.tsx' -ErrorAction SilentlyContinue
Remove-Item -LiteralPath 'src/routes/app.analytics.tsx' -ErrorAction SilentlyContinue
Remove-Item -LiteralPath 'src/routes/app.insights.tsx' -ErrorAction SilentlyContinue
Remove-Item -LiteralPath 'src/routes/app.materials.tsx' -ErrorAction SilentlyContinue
Remove-Item -LiteralPath 'src/routes/app.notifications.tsx' -ErrorAction SilentlyContinue
Remove-Item -LiteralPath 'src/routes/app.purchase-orders.$id.tsx' -ErrorAction SilentlyContinue
Remove-Item -LiteralPath 'src/routes/app.purchase-orders.index.tsx' -ErrorAction SilentlyContinue
Remove-Item -LiteralPath 'src/routes/app.requests.$id.tsx' -ErrorAction SilentlyContinue
Remove-Item -LiteralPath 'src/routes/app.requests.index.tsx' -ErrorAction SilentlyContinue
Remove-Item -LiteralPath 'src/routes/app.requests.new.tsx' -ErrorAction SilentlyContinue
Remove-Item -LiteralPath 'src/routes/app.rfqs.$id.tsx' -ErrorAction SilentlyContinue
Remove-Item -LiteralPath 'src/routes/app.rfqs.index.tsx' -ErrorAction SilentlyContinue
Remove-Item -LiteralPath 'src/routes/app.settings.tsx' -ErrorAction SilentlyContinue
Remove-Item -LiteralPath 'src/routes/app.suppliers.$id.tsx' -ErrorAction SilentlyContinue
Remove-Item -LiteralPath 'src/routes/app.suppliers.index.tsx' -ErrorAction SilentlyContinue
Remove-Item -LiteralPath 'src/routes/app.team.tsx' -ErrorAction SilentlyContinue
Remove-Item -LiteralPath 'src/routes/app.find-suppliers.tsx' -ErrorAction SilentlyContinue
Write-Host 'Old /app route files removed.'
