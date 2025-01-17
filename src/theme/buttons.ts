import { mode, StyleFunctionProps } from "@chakra-ui/theme-tools";
import colors from "./colors";

const buttons = {
  components: {
    Button: {
      variants: {
        brand: (props: StyleFunctionProps) => ({
          bg: mode(colors.brand[500], colors.brand.c)(props),
          color: "white",
          _hover: {
            bg: mode(colors.brand[600], colors.brand.c)(props),
          },
        }),
      },
    },
  },
};

export default buttons;
