
# Automatic Dividend Tracking

## Overview

The Portfolio calculates estimated historical dividend income
using Yahoo Finance.

No manual dividend entry is required.

No new PostgreSQL table is required.

## Data sources

Holdings:
- Existing PostgreSQL Holding model

Dividend events:
- Yahoo Finance chart API
- Historical ex-dividend dates
- Dividend amount per share

Exchange rates:
- Existing FetchFXRate service

## Calculation assumptions

The existing holding.purchase_date is treated as the
first date the user bought the stock.

The current holding.shares quantity is assumed to have
been held throughout the entire historical period.

This is a simplification.

Additional purchases, sales, stock splits and other
corporate actions may affect the accuracy of the result.

The system does not reconstruct historical transactions.

## Dividend eligibility

Historical events are selected from the first purchase
date through the current date.

The calculation uses ex-dividend dates, not verified
payment dates.

A purchase made on the ex-dividend date itself is
normally too late to qualify. The simplified implementation
currently includes events on that date and may therefore
overestimate entitlement.

Yahoo events are not proof that a broker paid the dividend.

## Calculations

Gross dividend in original currency:

    gross = shares * sum(dividend_per_share)

EUR conversion:

    gross_eur = gross * fx_to_eur

For EUR-denominated dividends:

    fx_to_eur = 1

For USD-denominated dividends:

    fx_to_eur = current USD/EUR rate

Estimated Portuguese tax:

    estimated_tax_eur = gross_eur * 0.28

Estimated net dividend:

    estimated_net_eur = gross_eur - estimated_tax_eur

Displayed All-Time P&L:

    all_time_pnl_eur =
        existing_price_pnl_eur + estimated_net_dividends_eur

The original backend price P&L is unchanged.

The frontend adds dividend estimates exactly once.

## Portuguese taxation

The 28% tax rate is a simplified reference assumption
for Portuguese individual investors.

It is not a calculation of final tax payable.

Actual taxation may differ due to:

- Foreign withholding tax
- Double-taxation treaties
- Foreign tax credits
- Englobamento
- Other applicable tax rules

All estimated taxes are shown in EUR.

The dividend's original USD or EUR currency is retained
for display and calculation.

The application does not claim to know how much tax
the user's broker actually withheld.

## API

GET /api/v1/portfolio/dividends

Returns:

- Estimated dividends for each holding
- Yahoo dividend events
- Original dividend currency
- Gross dividend in EUR
- Estimated Portuguese tax in EUR
- Estimated net dividend in EUR
- Portfolio dividend totals
- Per-holding errors
- Whether the result is complete

Force refresh:

GET /api/v1/portfolio/dividends?refresh=true

The endpoint uses existing authenticated API routing.

## Caching

Yahoo dividend events are cached in memory for six hours.

A force refresh bypasses the cache.

The cache is per backend instance.

Cloud Run instances may have different caches.

## Frontend

Holdings tab:
- Estimated net dividend column
- Combined P&L in EUR
- First Purchase Date field

Dividends tab:
- Yahoo refresh button
- Gross dividend estimate
- Portuguese tax estimate
- Net dividend estimate
- Per-company dividend history
- Ex-dividend dates and dividend amounts

## Files

New:
- pkg/services/dividends.go
- pkg/handlers/dividends.go
- docs/DIVIDEND_TRACKING.md

Modified:
- cmd/cloud/main.go
- frontend/src/services/api.js
- frontend/src/components/PortfolioTab.jsx

Optional local backend route:
- cmd/main.go

## Limitations

1. Current shares are used for all past events.
2. Yahoo dividend history can be incomplete.
3. Yahoo may rate-limit or change its unofficial API.
4. USD conversion uses the current rate.
5. Actual payment dates are not verified.
6. Actual broker withholding is not known.
7. Portuguese tax is estimated, not settled.
8. Closed positions are not included.
9. Realized capital gains from past sales are not included.
10. The existing price P&L remains based on open holdings.

## Deployment

Build the frontend with the existing Dockerfile.

Deploy the updated Go backend to the private
Google Cloud Run service.

Keep the existing Cloudflare Pages authentication
and proxy configuration.

No database migration is required.

## Future improvements

- Historical exchange rates per dividend event
- Confirmed payment-date data
- Broker statement reconciliation
- Foreign withholding and tax-credit accounting
- Historical purchase/sale transactions
- Dividend reporting by tax year
- Persistent cache
- Automated tests
