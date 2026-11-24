package tests

import (
	"fmt"
	"testing"

	"autoclicker/pkg/handlers"
)

func TestRouteLocalitySections(t *testing.T) {
	tests := []struct {
		Locality string
		Section  string
	}{
		{"Sabugal", "city"},
		{"SABUGAL", "city"},
		{"Sabugal, Guarda", "city"},
		{"Cidade do Sabugal", "city"},
		{"Rapoula do Côa", "villages"},
		{"Rapoula do Côa, Sabugal", "villages"},
		{"Soito", "villages"},
		{"Guarda", "villages"},
		{"", ""},
	}

	for _, test := range tests {
		t.Run(test.Locality, func(t *testing.T) {
			actual := handlers.ClassifyRouteLocality(test.Locality)

			if actual != test.Section {
				t.Fatalf(
					"section=%q; expected %q",
					actual,
					test.Section,
				)
			}
		})
	}
}

func TestSectionSplitsTwentyThreeDestinations(t *testing.T) {
	ordered := []handlers.RouteInputStop{{
		Address:   "Starting point",
		Latitude:  40.5,
		Longitude: -7.2,
	}}

	for index := 1; index <= 23; index++ {
		ordered = append(ordered, handlers.RouteInputStop{
			Address:   fmt.Sprintf("Destination %d", index),
			Latitude:  40.5 + float64(index)*0.001,
			Longitude: -7.2,
		})
	}

	segments, err := handlers.RouteSegmentsForSection(
		ordered,
		"city",
		0,
		10,
	)
	if err != nil {
		t.Fatal(err)
	}

	if len(segments) != 3 {
		t.Fatalf("Expected 3 links, got %d", len(segments))
	}

	counts := []int{10, 10, 3}

	for index, segment := range segments {
		if segment.DestinationCount != counts[index] {
			t.Fatalf(
				"Segment %d: destinations=%d; expected %d",
				index,
				segment.DestinationCount,
				counts[index],
			)
		}

		if segment.SectionRouteCount != 3 ||
			segment.SectionSequence != index+1 {
			t.Fatalf("Invalid section numbering: %+v", segment)
		}

		if index > 0 &&
			segment.StartStop != segments[index-1].EndStop {
			t.Fatal("The next link must begin at the previous link's end")
		}
	}
}

func TestDifferentShipmentsShareOneDestination(t *testing.T) {
	first := handlers.RouteInputStop{
		Address:   "Rua de exemplo 1",
		Locality:  "Sabugal",
		Section:   "city",
		Latitude:  40.35,
		Longitude: -7.09,
		Services: []handlers.RouteInputService{{
			ID:          "shipment-a",
			ParcelCount: 2,
		}},
	}

	second := first
	second.Services = []handlers.RouteInputService{{
		ID:          "shipment-b",
		ParcelCount: 1,
	}}

	result, err := handlers.PrepareRouteDestinations(
		[]handlers.RouteInputStop{first, second},
	)
	if err != nil {
		t.Fatal(err)
	}

	if len(result) != 1 || len(result[0].Services) != 2 {
		t.Fatalf("Services were lost or destinations duplicated: %+v", result)
	}
}

func TestSameDestinationCannotBelongToBothSections(t *testing.T) {
	first := handlers.RouteInputStop{
		Address:   "Example destination",
		Locality:  "Sabugal",
		Latitude:  40.35,
		Longitude: -7.09,
	}

	second := first
	second.Section = "villages"
	second.SectionOverride = true

	if _, err := handlers.PrepareRouteDestinations(
		[]handlers.RouteInputStop{first, second},
	); err == nil {
		t.Fatal("Expected conflicting destination sections to be rejected")
	}
}

func TestManualSectionOverride(t *testing.T) {
	result, err := handlers.PrepareRouteDestinations(
		[]handlers.RouteInputStop{{
			Address:         "Manually classified destination",
			Locality:        "Other locality",
			Section:         "city",
			SectionOverride: true,
			Latitude:        40.35,
			Longitude:       -7.09,
		}},
	)
	if err != nil {
		t.Fatal(err)
	}

	if len(result) != 1 || result[0].Section != "city" {
		t.Fatalf("Manual section override was lost: %+v", result)
	}
}
