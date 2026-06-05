import { Typography } from "antd";
import type { ReactNode } from "react";

type PageHeaderProps = {
  title: string;
  description: string;
  extra?: ReactNode;
};

export function PageHeader({ title, description, extra }: PageHeaderProps) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: "flex", alignItems: "start", justifyContent: "space-between", gap: 12 }}>
        <Typography.Title level={2} style={{ marginBottom: 4, fontSize: 25, lineHeight: 1.22 }}>
          {title}
        </Typography.Title>
        {extra ? <div style={{ flex: "0 0 auto", paddingTop: 2 }}>{extra}</div> : null}
      </div>
      <Typography.Paragraph type="secondary" style={{ maxWidth: 840, marginBottom: 0, fontSize: 13 }}>
        {description}
      </Typography.Paragraph>
    </div>
  );
}
