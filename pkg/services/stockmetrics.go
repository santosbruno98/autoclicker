package services

import (
	"autoclicker/pkg/database"
	"autoclicker/pkg/models"
	"fmt"
	"sort"
	"strconv"
	"strings"
)

func PrometheusStockMetrics() (string, error) {
	var thresholds []models.PriceThreshold

	if err := database.PortfolioDB.Find(&thresholds).Error; err != nil {
		return "", err
	}

	symbols := make(map[string]struct{}, len(thresholds))

	for _, threshold := range thresholds {
		if !threshold.Enabled {
			continue
		}

		symbols[threshold.Symbol] = struct{}{}
	}

	symbolList := make([]string, 0, len(symbols))

	for symbol := range symbols {
		symbolList = append(symbolList, symbol)
	}

	sort.Strings(symbolList)

	var builder strings.Builder

	builder.WriteString(
		"# HELP stock_price Current stock price returned by the quote provider.\n",
	)
	builder.WriteString("# TYPE stock_price gauge\n")

	builder.WriteString(
		"# HELP stock_price_threshold_above Configured upper stock price threshold.\n",
	)
	builder.WriteString("# TYPE stock_price_threshold_above gauge\n")

	builder.WriteString(
		"# HELP stock_price_threshold_below Configured lower stock price threshold.\n",
	)
	builder.WriteString("# TYPE stock_price_threshold_below gauge\n")

	for _, symbol := range symbolList {
		quote, err := FetchQuote(symbol)
		if err != nil {
			continue
		}

		builder.WriteString(fmt.Sprintf(
			"stock_price{symbol=%q,currency=%q} %s\n",
			symbol,
			quote.Currency,
			strconv.FormatFloat(quote.Price, 'f', -1, 64),
		))

		for _, threshold := range thresholds {
			if threshold.Symbol != symbol || !threshold.Enabled {
				continue
			}

			metricName := ""

			switch threshold.Condition {
			case models.ThresholdConditionAbove:
				metricName = "stock_price_threshold_above"

			case models.ThresholdConditionBelow:
				metricName = "stock_price_threshold_below"

			default:
				continue
			}

			builder.WriteString(fmt.Sprintf(
				"%s{symbol=%q,currency=%q} %s\n",
				metricName,
				symbol,
				quote.Currency,
				strconv.FormatFloat(
					threshold.TargetPrice,
					'f',
					-1,
					64,
				),
			))
		}
	}

	return builder.String(), nil
}
