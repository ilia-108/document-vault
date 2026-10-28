package documents

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"math"
	"sort"
	"strconv"
	"strings"
)

type Field struct {
	Name  string `json:"name"`
	Label string `json:"label"`
	Type  string `json:"type"`
}

var SchemaFields = []Field{{"title", "Title", "string"}, {"owner", "Owner", "string"}, {"tags", "Tags", "array"}, {"versionCount", "Versions", "number"}, {"latestVersion.versionNumber", "Latest version", "number"}, {"latestVersion.versionName", "Version name", "string"}, {"latestVersion.capturedAt", "Captured at", "date"}, {"latestVersion.file.mediaType", "File type", "string"}, {"latestVersion.file.sizeBytes", "File size", "bytes"}, {"latestVersion.checksum.value", "SHA-256", "checksum"}}

type Filter struct {
	Field    string `json:"field"`
	Operator string `json:"operator"`
	Value    any    `json:"value"`
}
type Sort struct {
	Field     string `json:"field"`
	Direction string `json:"direction"`
}
type DateRange struct {
	From int64 `json:"from"`
	To   int64 `json:"to"`
}
type SearchRequest struct {
	Text      string     `json:"text"`
	Filters   []Filter   `json:"filters"`
	Sort      *Sort      `json:"sort"`
	TimeRange *DateRange `json:"timeRange"`
	Limit     *int       `json:"limit"`
	Cursor    *string    `json:"cursor"`
}
type page[T any] struct {
	Items      []T     `json:"items"`
	Total      int     `json:"total"`
	NextCursor *string `json:"nextCursor"`
}

func paginate[T any](items []T, limit int, cursor *string, scope string) (page[T], error) {
	var empty page[T]
	if limit < 1 || limit > 100 {
		return empty, apiError(400, "Limit must be between 1 and 100")
	}
	offset := 0
	if cursor != nil && *cursor != "" {
		data, err := base64.RawURLEncoding.DecodeString(*cursor)
		var value struct {
			Offset int    `json:"offset"`
			Scope  string `json:"scope"`
		}
		if err != nil || json.Unmarshal(data, &value) != nil || value.Offset < 0 || value.Scope != scope {
			return empty, apiError(400, "Invalid cursor")
		}
		offset = value.Offset
	}
	if offset > len(items) {
		offset = len(items)
	}
	end := offset + limit
	if end > len(items) {
		end = len(items)
	}
	result := page[T]{Items: items[offset:end], Total: len(items)}
	if end < len(items) {
		data, _ := json.Marshal(struct {
			Offset int    `json:"offset"`
			Scope  string `json:"scope"`
		}{end, scope})
		value := base64.RawURLEncoding.EncodeToString(data)
		result.NextCursor = &value
	}
	return result, nil
}
func fieldValue(document Document, path string) any {
	switch path {
	case "title":
		return document.Title
	case "owner":
		return document.Owner
	case "tags":
		return strings.Join(document.Tags, ", ")
	case "versionCount":
		return float64(document.VersionCount)
	case "latestVersion.versionNumber":
		return float64(document.LatestVersion.VersionNumber)
	case "latestVersion.versionName":
		return document.LatestVersion.VersionName
	case "latestVersion.capturedAt":
		return float64(document.LatestVersion.CapturedAt)
	case "latestVersion.file.mediaType":
		return document.LatestVersion.File.MediaType
	case "latestVersion.file.sizeBytes":
		return float64(document.LatestVersion.File.SizeBytes)
	case "latestVersion.checksum.value":
		return document.LatestVersion.Checksum.Value
	}
	return nil
}
func search(documents []Document, query SearchRequest) (page[Document], error) {
	var empty page[Document]
	allowed := map[string]string{}
	for _, field := range SchemaFields {
		allowed[field.Name] = field.Type
	}
	order := Sort{"latestVersion.capturedAt", "desc"}
	if query.Sort != nil {
		order = *query.Sort
	}
	if allowed[order.Field] == "" || (order.Direction != "asc" && order.Direction != "desc") {
		return empty, apiError(400, "Invalid sort")
	}
	if len(query.Filters) > 50 || len(query.Text) > 2000 {
		return empty, apiError(400, "Search query is too large")
	}
	if query.TimeRange != nil && query.TimeRange.From > query.TimeRange.To {
		return empty, apiError(400, "Invalid date range")
	}
	for _, filter := range query.Filters {
		if allowed[filter.Field] == "" {
			return empty, apiError(400, "Unknown filter field")
		}
		switch filter.Value.(type) {
		case string, float64:
		default:
			return empty, apiError(400, "Invalid filter value")
		}
		switch filter.Operator {
		case "equals", "notEquals", "contains":
		case "greaterThan", "lessThan":
			kind := allowed[filter.Field]
			number, err := strconv.ParseFloat(fmt.Sprint(filter.Value), 64)
			if (kind != "number" && kind != "date" && kind != "bytes") || err != nil || math.IsNaN(number) || math.IsInf(number, 0) {
				return empty, apiError(400, "Invalid numeric comparison")
			}
		default:
			return empty, apiError(400, "Invalid filter operator")
		}
	}
	result := make([]Document, 0, len(documents))
	text := strings.ToLower(strings.TrimSpace(query.Text))
	for _, document := range documents {
		if text != "" && !strings.Contains(strings.ToLower(document.Title+"\x00"+document.Owner+"\x00"+document.LatestVersion.File.Name+"\x00"+document.LatestVersion.VersionName), text) {
			continue
		}
		if query.TimeRange != nil && (document.LatestVersion.CapturedAt < query.TimeRange.From || document.LatestVersion.CapturedAt > query.TimeRange.To) {
			continue
		}
		matches := true
		for _, filter := range query.Filters {
			actual, value := fmt.Sprint(fieldValue(document, filter.Field)), fmt.Sprint(filter.Value)
			valid := false
			switch filter.Operator {
			case "equals":
				valid = actual == value
			case "notEquals":
				valid = actual != value
			case "contains":
				valid = strings.Contains(strings.ToLower(actual), strings.ToLower(value))
			case "greaterThan", "lessThan":
				a, _ := strconv.ParseFloat(actual, 64)
				b, _ := strconv.ParseFloat(value, 64)
				valid = !math.IsNaN(b) && ((filter.Operator == "greaterThan" && a > b) || (filter.Operator == "lessThan" && a < b))
			}
			if !valid {
				matches = false
				break
			}
		}
		if matches {
			result = append(result, document)
		}
	}
	sort.Slice(result, func(i, j int) bool {
		a, b := fieldValue(result[i], order.Field), fieldValue(result[j], order.Field)
		comparison := strings.Compare(fmt.Sprint(a), fmt.Sprint(b))
		if x, ok := a.(float64); ok {
			y := b.(float64)
			comparison = 0
			if x < y {
				comparison = -1
			}
			if x > y {
				comparison = 1
			}
		}
		if comparison == 0 {
			return result[i].DocumentID < result[j].DocumentID
		}
		if order.Direction == "desc" {
			return comparison > 0
		}
		return comparison < 0
	})
	scopeQuery := query
	scopeQuery.Cursor = nil
	scopeQuery.Limit = nil
	encoded, _ := json.Marshal(scopeQuery)
	limit := 20
	if query.Limit != nil {
		limit = *query.Limit
	}
	return paginate(result, limit, query.Cursor, digest(encoded))
}
