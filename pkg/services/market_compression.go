package services

import (
	"bytes"
	"compress/gzip"
	"encoding/json"
	"fmt"
	"io"
)

const maxDecompressedMarketJSON = 32 << 20

func CompressMarketJSON(value any) ([]byte, error) {
	raw, err := json.Marshal(value)
	if err != nil {
		return nil, fmt.Errorf("Marshal market JSON: %w", err)
	}

	var buffer bytes.Buffer
	writer := gzip.NewWriter(&buffer)

	if _, err := writer.Write(raw); err != nil {
		return nil, fmt.Errorf("gzip write: %w", err)

	}
	return buffer.Bytes(), nil
}

func DecompressMarketJSON(value []byte, target any) error {
	reader, err := gzip.NewReader(bytes.NewReader(value))
	if err != nil {
		return fmt.Errorf("gzip read: %w", err)
	}
	defer reader.Close()

	raw, err := io.ReadAll(
		io.LimitReader(
			reader,
			int64(maxDecompressedMarketJSON)+1,
		),
	)
	if err != nil {
		return fmt.Errorf("Decompressed Market JSON exceeds max size of %d bytes: %w", maxDecompressedMarketJSON, err)
	}

	if err := json.Unmarshal(raw, target); err != nil {
		return fmt.Errorf("decode market JSON: %w", err)
	}
	return nil
}
