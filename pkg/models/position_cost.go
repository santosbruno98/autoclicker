package models

import (
	"errors"
	"fmt"
	"math/big"
)

type TradeSide string

const (
	TradeBuy  TradeSide = "buy"
	TradeSell TradeSide = "sell"
)

var ErrInsufficientShares = errors.New(
	"sell exceeds shares held on the trade date",
)

type CostTrade struct {
	ID        uint
	Side      TradeSide
	Shares    string
	UnitPrice *big.Rat
}

type PositionCost struct {
	AverageCost     *big.Rat
	RealizedGain    *big.Rat
	RealizedByTrade map[uint]*big.Rat
}

// CalculatePositionCost expects trades in chronological order, with
// transaction ID breaking ties. Unit prices must share a reporting currency.
func CalculatePositionCost(trades []CostTrade) (PositionCost, error) {
	result := PositionCost{
		AverageCost:     new(big.Rat),
		RealizedGain:    new(big.Rat),
		RealizedByTrade: make(map[uint]*big.Rat),
	}

	openShares := new(big.Rat)
	openCost := new(big.Rat)

	for _, trade := range trades {
		shares, ok := new(big.Rat).SetString(trade.Shares)
		if !ok || shares.Sign() <= 0 {
			return PositionCost{}, fmt.Errorf("trade %d: invalid shares", trade.ID)
		}
		if trade.UnitPrice == nil || trade.UnitPrice.Sign() < 0 {
			return PositionCost{}, fmt.Errorf("trade %d: invalid price", trade.ID)
		}

		value := new(big.Rat).Mul(shares, trade.UnitPrice)

		switch trade.Side {
		case TradeBuy:
			openShares.Add(openShares, shares)
			openCost.Add(openCost, value)

		case TradeSell:
			if shares.Cmp(openShares) > 0 {
				return PositionCost{}, fmt.Errorf(
					"trade %d: %w", trade.ID, ErrInsufficientShares,
				)
			}

			costSold := new(big.Rat).Mul(result.AverageCost, shares)
			gain := new(big.Rat).Sub(value, costSold)

			openShares.Sub(openShares, shares)
			openCost.Sub(openCost, costSold)
			result.RealizedGain.Add(result.RealizedGain, gain)
			result.RealizedByTrade[trade.ID] = gain

		default:
			return PositionCost{}, fmt.Errorf("trade %d: invalid side", trade.ID)
		}

		if openShares.Sign() == 0 {
			result.AverageCost.SetInt64(0)
		} else {
			result.AverageCost.Quo(openCost, openShares)
		}
	}

	return result, nil
}
