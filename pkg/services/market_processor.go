package services

import (
	"bytes"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"

	"autoclicker/pkg/models"
)

type pythonMarketResult struct {
	SourceFile string                 `json:"source_file"`
	Companies  []models.MarketCompany `json:"companies"`
	AISummary  string                 `json:"ai_summary"`
}

func ProcessMarketPDF(pdfPath string) (models.MarketDocumentResult, error) {
	pythonExecutable := os.Getenv("PYTHON_EXECUTABLE")

	if pythonExecutable == "" {
		if runtime.GOOS == "windows" {
			pythonExecutable = filepath.Join(
				"market_processor",
				"venv",
				"Scripts",
				"python.exe",
			)
		} else {
			pythonExecutable = "python3"
		}
	}

	scriptPath, err := getMarketProcessorPath()
	if err != nil {
		return models.MarketDocumentResult{}, err
	}

	cmd := exec.Command(
		pythonExecutable,
		scriptPath,
		pdfPath,
	)

	var stdout bytes.Buffer
	var stderr bytes.Buffer

	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	if err := cmd.Run(); err != nil {
		return models.MarketDocumentResult{}, fmt.Errorf(
			"market processor failed: %w: %s",
			err,
			stderr.String(),
		)
	}

	var result pythonMarketResult

	if err := json.Unmarshal(stdout.Bytes(), &result); err != nil {
		return models.MarketDocumentResult{}, fmt.Errorf(
			"invalid market processor response: %w",
			err,
		)
	}

	return models.MarketDocumentResult{
		SourceFile: result.SourceFile,
		Companies:  result.Companies,
		AISummary:  result.AISummary,
	}, nil
}

func getMarketProcessorPath() (string, error) {
	scriptPath := filepath.Join(
		"market_processor",
		"market_processor.py",
	)

	absolutePath, err := filepath.Abs(scriptPath)
	if err != nil {
		return "", fmt.Errorf(
			"failed to resolve market processor path: %w",
			err,
		)
	}

	if _, err := os.Stat(absolutePath); err != nil {
		return "", fmt.Errorf(
			"market processor script not found at %s: %w",
			absolutePath,
			err,
		)
	}

	return absolutePath, nil
}
