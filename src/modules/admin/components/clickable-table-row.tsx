import LocalizedClientLink from "@modules/common/components/localized-client-link"

interface ClickableTableRowProps {
    href: string
    children: React.ReactNode
    className?: string
}

export function ClickableTableRow({ href, children, className }: ClickableTableRowProps) {
    return (
        <tr className={`relative group ${className}`}>
            {children}
            {/* Hidden link overlay for native navigation without background prefetching */}
            <td className="p-0 border-none pointer-events-none">
                <LocalizedClientLink
                    href={href}
                    prefetch={false}
                    className="absolute inset-0 z-10 w-full h-full opacity-0 pointer-events-auto"
                    aria-hidden="true"
                />
            </td>
        </tr>
    )
}
