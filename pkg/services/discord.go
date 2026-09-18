package services

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"

	"os"
)

type GrafanaAlertWebhook struct {
	Status string         `json:"status"`
	Alerts []GrafanaAlert `json:"alerts"`
}

type GrafanaAlert struct {
	Status      string             `json:"status"`
	Labels      map[string]string  `json:"labels"`
	Annotations map[string]string  `json:"annotations"`
	StartsAt    string             `json:"startsAt"`
	EndsAt      string             `json:"endsAt"`
	ValueString string             `json:"valueString"`
	Values      map[string]float64 `json:"values"`
}

type discordWebhookPayload struct {
	Content string `json:"content"`
}

func HandlerGrafanaAlert(payload GrafanaAlertWebhook) error {
	webhookURL := strings.TrimSpace(
		os.Getenv("DISCORD_WEBHOOK_URL"), //TODO : get this URL
	)
	if webhookURL == "" {
		return fmt.Errorf("missing Discord webhook URL")
	}

	message := buildDiscordAlertMessage(payload)

	body, err := json.Marshal(discordWebhookPayload{
		Content: message,
	})
	if err != nil {
		return err
	}

	req, err := http.NewRequest("POST", webhookURL, bytes.NewBuffer(body))
	if err != nil {
		return err
	}

	req.Header.Set("Content-Type", "application/json")

	client := &http.Client{}
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("failed to send Discord alert: %s", resp.Status)
	}

	return nil
}

func buildDiscordAlertMessage(
	payload GrafanaAlertWebhook,
) string {
	status := strings.ToUpper(payload.Status)

	if status == "" {
		status = "ALERT"
	}

	var builder strings.Builder

	builder.WriteString(
		fmt.Sprintf(
			"🚨 **Stock price alert — %s**\n",
			status,
		),
	)

	for _, alert := range payload.Alerts {
		symbol := alert.Labels["symbol"]
		condition := alert.Labels["condition"]

		if condition == "" {
			condition = "threshold"
		}

		summary := alert.Annotations["summary"]

		if summary == "" {
			summary = fmt.Sprintf(
				"%s %s threshold triggered",
				symbol,
				condition,
			)
		}

		builder.WriteString(
			fmt.Sprintf(
				"\n**%s**\n",
				summary,
			),
		)

		if symbol != "" {
			builder.WriteString(
				fmt.Sprintf(
					"• Symbol: `%s`\n",
					symbol,
				),
			)
		}

		builder.WriteString(
			fmt.Sprintf(
				"• Condition: `%s`\n",
				condition,
			),
		)

		if value, ok := alert.Values["A"]; ok {
			builder.WriteString(
				fmt.Sprintf(
					"• Current price: `%.4f`\n",
					value,
				),
			)
		}

		if value, ok := alert.Values["B"]; ok {
			builder.WriteString(
				fmt.Sprintf(
					"• Threshold: `%.4f`\n",
					value,
				),
			)
		}

		if alert.ValueString != "" {
			builder.WriteString(
				fmt.Sprintf(
					"• Evaluation: `%s`\n",
					alert.ValueString,
				),
			)
		}

		if alert.StartsAt != "" {
			builder.WriteString(
				fmt.Sprintf(
					"• Started: `%s`\n",
					alert.StartsAt,
				),
			)
		}
	}

	message := builder.String()

	if len(message) > 1900 {
		message = message[:1900] + "\n…"
	}

	return message
}
