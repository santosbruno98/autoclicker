import React from 'react';

export default function KafkaLogsTab() {
  return (
    <div className="w-full h-[calc(100vh-160px)] min-h-[600px] rounded border border-slate-800 overflow-hidden bg-slate-900">
      <iframe
        src="/kafka-ui/"
        title="Kafka UI"
        className="w-full h-full border-0"
      />
    </div>
  );
}